import { describe, expect, it } from "vitest";
import { engagementReport } from "../src/index";

const row = (id: string, at: string) => ({ install_id: id, received_at: at });
const many = (n: number, at: string) => Array.from({ length: n }, (_, i) => row(`tester${i}-xxxx`, at));

describe("engagementReport", () => {
  it("computes day, active_days and quiet_days", () => {
    const r = engagementReport(
      [
        row("aaaaaaaa-1", "2026-11-01T10:00:00Z"), row("aaaaaaaa-1", "2026-11-01T18:00:00Z"), row("aaaaaaaa-1", "2026-11-04T09:00:00Z"),
        row("bbbbbbbb-2", "2026-11-02T10:00:00Z"),
        row("cccccccc-3", "2026-11-05T10:00:00Z"), row("cccccccc-3", "2026-11-06T10:00:00Z"),
      ],
      { now: "2026-11-06T12:00:00Z" },
    );
    expect(r.day).toBe(6);
    const by = Object.fromEntries(r.testers.map((t) => [t.install_id, t]));
    expect(by["aaaaaaaa-1"]).toMatchObject({ active_days: 2, quiet_days: 2 });
    expect(by["bbbbbbbb-2"]).toMatchObject({ active_days: 1, quiet_days: 4 });
    expect(by["cccccccc-3"]).toMatchObject({ active_days: 2, quiet_days: 0 });
    expect(r.active_testers).toBe(2);
  });

  it("caps day at windowDays", () => {
    expect(engagementReport([row("a", "2026-10-01T00:00:00Z")], { now: "2026-11-06T00:00:00Z" }).day).toBe(14);
  });

  it("warns about a tester quiet for 3 days, naming the short id", () => {
    const r = engagementReport([row("abcdef123456", "2026-11-03T00:00:00Z")], { now: "2026-11-06T01:00:00Z" });
    expect(r.warnings.some((w) => w.includes("abcdef12") && w.includes("3 days"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("abcdef123456"))).toBe(false);
  });

  it("warns about the clock reset at 11 active testers but not at 12", () => {
    const now = "2026-11-06T00:00:00Z";
    const at = "2026-11-05T00:00:00Z";
    const has = (n: number) => engagementReport(many(n, at), { now }).warnings.some((w) => w.includes("clock resets"));
    expect(has(11)).toBe(true);
    expect(has(12)).toBe(false);
  });

  it("asks to recruit up to the target", () => {
    const r = engagementReport(many(12, "2026-11-05T00:00:00Z"), { now: "2026-11-06T00:00:00Z" });
    expect(r.warnings.some((w) => w.includes("recruit 4 more"))).toBe(true);
    expect(engagementReport(many(16, "2026-11-05T00:00:00Z"), { now: "2026-11-06T00:00:00Z" }).warnings).toEqual([]);
  });

  it("adds a reminder on day 5 and day 10 only", () => {
    const rows = many(16, "2026-11-01T00:00:00Z");
    const w = (now: string) => engagementReport(many(16, "2026-11-01T00:00:00Z").concat(many(16, now)), { now }).warnings.filter((x) => x.startsWith("Day "));
    expect(w("2026-11-05T00:00:00Z")).toHaveLength(1);
    expect(w("2026-11-10T00:00:00Z")).toHaveLength(1);
    expect(w("2026-11-06T00:00:00Z")).toHaveLength(0);
  });

  it("returns an empty report for no rows", () => {
    expect(engagementReport([], { now: "2026-11-06T00:00:00Z" })).toEqual({ day: 0, active_testers: 0, testers: [], warnings: [] });
  });
});
