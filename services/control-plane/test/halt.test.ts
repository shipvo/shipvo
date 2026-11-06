import { describe, it, expect } from "vitest";
import { shouldHalt, tallyVotes, FAILED_EVENTS, HEALTHY_EVENTS } from "../src/halt";

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

const vote = (id: string, net: string | null, failed = true) => ({ install_id: id, net_hash: net, failed, healthy: !failed });
const decide = (votes: ReturnType<typeof vote>[]) => shouldHalt(tallyVotes(votes), { threshold: 0.2, minReports: 20 }).halt;

describe("corroboration", () => {
  it("1000 unverified failures never halt (no verified votes)", () => {
    expect(decide([])).toBe(false);
  });
  it("one install voting many times never halts", () => {
    expect(decide(Array.from({ length: 1000 }, () => vote("a", "n1")))).toBe(false);
  });
  it("many installs from one network never halt", () => {
    expect(decide(Array.from({ length: 100 }, (_, i) => vote("i" + i, "n1")))).toBe(false);
  });
  it("20 verified installs across 3 networks halt", () => {
    expect(decide(Array.from({ length: 20 }, (_, i) => vote("i" + i, "n" + (i % 3))))).toBe(true);
  });
  it("19 installs across 3 networks do not halt", () => {
    expect(decide(Array.from({ length: 19 }, (_, i) => vote("i" + i, "n" + (i % 3))))).toBe(false);
  });
  it("an install that failed and applied counts once, as failed", () => {
    const t = tallyVotes([vote("a", "n1"), vote("a", "n1", false)]);
    expect(t).toMatchObject({ failed: 1, healthy: 0, installs: 1 });
  });
  it("min_installs is configurable", () => {
    const t = tallyVotes(Array.from({ length: 5 }, (_, i) => vote("i" + i, "n" + (i % 3))));
    expect(shouldHalt(t, { threshold: 0.2, minReports: 5, minInstalls: 5 }).halt).toBe(true);
  });
});

describe("null net_hash", () => {
  it("cannot satisfy the 3-network rule", () => {
    const votes = Array.from({ length: 30 }, (_, i) => ({ install_id: "i" + i, net_hash: null, failed: true, healthy: false }));
    expect(shouldHalt(tallyVotes(votes), { threshold: 0.2, minReports: 20 }).halt).toBe(false);
  });
});
