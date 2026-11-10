import { beforeEach, describe, expect, it, vi } from "vitest";

async function load(native: any) {
  vi.resetModules();
  (globalThis as any).__native = native;
  return import("../src/index");
}
beforeEach(() => { delete (globalThis as any).__native; });

describe("getAppliedStateVersion", () => {
  it("returns the version the native module reports", async () => {
    const { getAppliedStateVersion, Runtime } = await load({ getAppliedStateVersion: async () => 3 });
    expect(await getAppliedStateVersion()).toBe(3);
    expect(await Runtime.getAppliedStateVersion()).toBe(3);
  });
  it("returns null when the release declared none", async () => {
    const { getAppliedStateVersion } = await load({ getAppliedStateVersion: async () => null });
    expect(await getAppliedStateVersion()).toBeNull();
  });
  it("returns null with an older shell that lacks the method", async () => {
    const { getAppliedStateVersion } = await load({});
    expect(await getAppliedStateVersion()).toBeNull();
  });
  it("returns null when there is no native module", async () => {
    const { getAppliedStateVersion } = await load(undefined);
    expect(await getAppliedStateVersion()).toBeNull();
  });
});
