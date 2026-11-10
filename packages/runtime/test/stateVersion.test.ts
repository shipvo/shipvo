import { describe, expect, it, vi } from "vitest";
import { pickRevertTarget } from "../src/index";

describe("pickRevertTarget", () => {
  const rel = (release: number, stateVersion?: number) => ({ release, stateVersion });
  it("skips a release with a lower state version and picks the next eligible one", () => {
    expect(pickRevertTarget(3, [rel(8, 2), rel(7, 3), rel(6, 2)])?.release).toBe(7);
  });
  it("accepts a higher state version", () => {
    expect(pickRevertTarget(2, [rel(8, 4)])?.release).toBe(8);
  });
  it("returns null (embedded bundle) when none qualifies", () => {
    expect(pickRevertTarget(3, [rel(8, 2), rel(7), rel(6, 1)])).toBeNull();
  });
  it("treats a device without a declaration as 0, so any release qualifies", () => {
    expect(pickRevertTarget(0, [rel(8), rel(7, 2)])?.release).toBe(8);
  });
});

describe("getAppliedStateVersion", () => {
  async function withState(state: unknown) {
    vi.resetModules();
    (globalThis as any).__native = { getState: () => state, consumeEvents: () => [], markHealthy: () => ({}), rollback() {}, reload() {}, checkForUpdate: async () => ({ status: "none" }) };
    return import("../src/index");
  }
  it("returns the state version the native runtime reports", async () => {
    expect((await withState({ stateVersion: 3 })).getAppliedStateVersion()).toBe(3);
  });
  it("returns 0 when none is declared", async () => {
    expect((await withState({})).getAppliedStateVersion()).toBe(0);
  });
});
