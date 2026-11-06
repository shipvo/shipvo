import { describe, expect, it } from "vitest";
import { looksLikeAttack } from "../src/halt";

const now = 1_800_000_000_000;
const H = 60 * 60 * 1000;
const mk = (ages: number[]) => ages.map((a, i) => ({ install_id: `i${i}`, registered_at: now - a }));

describe("looksLikeAttack", () => {
  it("flags mostly fresh failing installs", () => {
    const r = looksLikeAttack({ failingInstalls: mk([60_000, 120_000, 600_000, 30 * H]), recentReports: 4, normalRate: 4, now });
    expect(r).toEqual({ suspicious: true, reason: "fresh_installs" });
  });
  it("flags a burst over the normal rate", () => {
    const r = looksLikeAttack({ failingInstalls: mk([30 * H, 40 * H, 50 * H]), recentReports: 100, normalRate: 5, now });
    expect(r).toEqual({ suspicious: true, reason: "burst" });
  });
  it("passes established installs at a normal rate", () => {
    const r = looksLikeAttack({ failingInstalls: mk([30 * H, 40 * H, 50 * H]), recentReports: 6, normalRate: 5, now });
    expect(r).toEqual({ suspicious: false, reason: null });
  });
  it("does not crash or flag a burst with no history", () => {
    expect(looksLikeAttack({ failingInstalls: [], recentReports: 500, now })).toEqual({ suspicious: false, reason: null });
    expect(looksLikeAttack({ failingInstalls: mk([30 * H]), recentReports: 500, normalRate: 0, now }).suspicious).toBe(false);
  });
});
