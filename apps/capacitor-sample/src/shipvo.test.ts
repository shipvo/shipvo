import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
let platform = "ios";
let serving = "";
let served = true;

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => platform },
  registerPlugin: () => ({ status: async () => ({ serving }) }),
}));
vi.mock("@shipvo/capacitor", () => ({
  NativeStore: class {}, NativeFiles: class {},
  ShipvoCapacitor: class {
    markHealthy() { calls.push("markHealthy"); return Promise.resolve(); }
    checkForUpdate() { calls.push("checkForUpdate"); return Promise.resolve(); }
  },
  bootAndServe: async () => ({ served, release: served && serving ? 2 : 0 }),
  bootAndSwitch: async () => undefined,
}));
vi.mock("./launch.js", () => ({
  versionLabel: (s?: string) => (s ? "v2" : "v1"),
  announceVersion: async (label: string) => { calls.push(`announce ${label}`); },
}));

const g = globalThis as Record<string, unknown>;

async function run() {
  vi.resetModules();
  const { startShipvo } = await import("./shipvo.js");
  return startShipvo();
}

beforeEach(() => {
  calls.length = 0; platform = "ios"; serving = ""; served = true;
  g.__SHIPVO_PUBLIC_KEY__ = "key"; g.__SHIPVO_BASE_URL__ = "http://x"; g.__SHIPVO_SIM_CHECK__ = false;
  g.window = {};
});

describe("startShipvo", () => {
  it("does not mark healthy or announce when about to switch to a staged bundle", async () => {
    expect(await run()).toBeDefined();
    expect(calls).toEqual([]);
  });
  it("announces v2 and marks healthy when the page came from a bundle", async () => {
    serving = "release-2.bundle";
    await run();
    expect(calls).toEqual(["announce v2", "markHealthy"]);
  });
  it("returns undefined on web", async () => {
    platform = "web";
    expect(await run()).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
