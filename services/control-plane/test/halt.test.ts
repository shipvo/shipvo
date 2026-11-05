import { describe, it, expect } from "vitest";
import { shouldHalt, FAILED_EVENTS, HEALTHY_EVENTS } from "../src/halt";

describe("shouldHalt", () => {
  it("halts when share is over the threshold", () => {
    expect(shouldHalt({ healthy: 14, failed: 6 }, { threshold: 0.2, minReports: 20 })).toEqual({ halt: true, reports: 20, failureShare: 0.3 });
  });
  it("does not halt below minReports", () => {
    expect(shouldHalt({ healthy: 0, failed: 19 }, { threshold: 0.2, minReports: 20 }).halt).toBe(false);
  });
  it("does not halt when share equals the threshold", () => {
    expect(shouldHalt({ healthy: 3, failed: 1 }, { threshold: 0.25, minReports: 1 }).halt).toBe(false);
  });
  it("never halts on an unusable threshold", () => {
    for (const threshold of [undefined, 0, -0.5, 1.5]) {
      expect(shouldHalt({ healthy: 0, failed: 100 }, { threshold, minReports: 1 }).halt).toBe(false);
    }
  });
  it("halts at threshold 1 only if share exceeds it (never)", () => {
    expect(shouldHalt({ healthy: 0, failed: 100 }, { threshold: 1, minReports: 1 }).halt).toBe(false);
  });
  it("handles zero reports", () => {
    expect(shouldHalt({ healthy: 0, failed: 0 }, { threshold: 0.2, minReports: 0 })).toEqual({ halt: false, reports: 0, failureShare: 0 });
  });
  it("exports event lists", () => {
    expect(FAILED_EVENTS).toEqual(["rolled_back", "crash_loop_revert", "verify_failed", "download_failed"]);
    expect(HEALTHY_EVENTS).toEqual(["applied", "content_applied"]);
  });
});
