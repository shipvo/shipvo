import { describe, expect, it } from "vitest";
import { parsePolicy } from "@shipvo/schema";
import { checkPolicy, checkPublishPolicy } from "../src/policy";

// 2026-11-05 is a Thursday (local time).
const thu = (h: number) => new Date(2026, 10, 5, h, 0, 0);
const fri = (h: number) => new Date(2026, 10, 6, h, 0, 0);

describe("checkPolicy", () => {
  it("no policy means no rules", () => {
    expect(checkPolicy(undefined, { band: "b2", actorKind: "agent", now: thu(23) })).toEqual({ ok: true });
  });
  it("maxBand", () => {
    const p = { maxBand: "b1" as const };
    expect(checkPolicy(p, { band: "b1", actorKind: "human", now: thu(9) })).toEqual({ ok: true });
    const r = checkPolicy(p, { band: "b2", actorKind: "human", now: thu(9) });
    expect(r).toMatchObject({ ok: false, rule: "maxBand" });
    expect((r as { reason: string }).reason).toMatch(/b2.*b1/);
  });
  it("agentMaxBand applies to agents only", () => {
    const p = { agentMaxBand: "b0" as const };
    expect(checkPolicy(p, { band: "b0", actorKind: "agent", now: thu(9) })).toEqual({ ok: true });
    expect(checkPolicy(p, { band: "b2", actorKind: "human", now: thu(9) })).toEqual({ ok: true });
    expect(checkPolicy(p, { band: "b1", actorKind: "agent", now: thu(9) })).toMatchObject({ ok: false, rule: "agentMaxBand" });
  });
  it("blocked weekday after the boundary hour", () => {
    const p = { blockedWeekdays: ["thu" as const], blockedAfterHour: 16 };
    const ctx = { band: "b0" as const, actorKind: "human" as const };
    expect(checkPolicy(p, { ...ctx, now: thu(15) })).toEqual({ ok: true });
    expect(checkPolicy(p, { ...ctx, now: thu(16) })).toMatchObject({ ok: false, rule: "blockedWeekdays" });
    expect(checkPolicy(p, { ...ctx, now: fri(20) })).toEqual({ ok: true });
  });
  it("blocked weekday without an hour blocks the whole day", () => {
    expect(checkPolicy({ blockedWeekdays: ["thu"] }, { band: "b0", actorKind: "human", now: thu(0) })).toMatchObject({ ok: false });
  });
});

describe("policy validation", () => {
  it("names the bad field", () => {
    expect(() => parsePolicy({ maxBand: "b9" })).toThrow(/policy\.maxBand/);
    expect(() => parsePolicy({ blockedAfterHour: 24, blockedWeekdays: ["mon"] })).toThrow(/policy\.blockedAfterHour/);
    expect(() => parsePolicy({ blockedWeekdays: ["funday"] })).toThrow(/policy\.blockedWeekdays/);
    expect(() => parsePolicy({ blockedAfterHour: 5 })).toThrow(/policy\.blockedAfterHour/);
    expect(() => parsePolicy({ maxBnd: "b1" })).toThrow(/policy/);
  });
  it("checkPublishPolicy uses the widest band and SHIPVO_ACTOR", () => {
    const raw = { agentMaxBand: "b0" };
    expect(checkPublishPolicy(undefined, ["b0", "b1", "b2"])).toEqual({ ok: true });
    expect(checkPublishPolicy(raw, ["b0", "b1"], thu(9), { SHIPVO_ACTOR: "agent" })).toMatchObject({ ok: false, rule: "agentMaxBand" });
    expect(checkPublishPolicy(raw, ["b0", "b1"], thu(9), {})).toEqual({ ok: true });
  });
});
