import { afterEach, describe, expect, it, vi } from "vitest";
import Module from "node:module";

// Runs the native device (packages/device/src/index.ts) with mocked react-native and expo-notifications.
vi.mock("react-native", () => ({ Platform: { OS: "android" }, Share: {}, Linking: {} }));
const M = Module as any; const realLoad = M._load;
async function load(mod: any) {
  vi.resetModules();
  M._load = function (req: string, ...rest: any[]) {
    if (req !== "expo-notifications") return realLoad.call(this, req, ...rest);
    if (!mod) throw new Error("Cannot find module 'expo-notifications'");
    return mod;
  };
  return (await import("../../device/src/index")).device;
}
afterEach(() => { M._load = realLoad; });

describe("native notifications", () => {
  it("reports real when expo-notifications resolves", async () => { expect((await load({})).capabilities().notifications).toBe("real"); });
  it("reports unavailable when it does not", async () => { expect((await load(null)).capabilities().notifications).toBe("unavailable"); });
  it("maps received and tapped events to the device shape", async () => {
    const handlers: Record<string, (x: any) => void> = {};
    const remove = vi.fn();
    const N = {
      addNotificationReceivedListener: (f: any) => { handlers.recv = f; return { remove }; },
      addNotificationResponseReceivedListener: (f: any) => { handlers.tap = f; return { remove }; },
    };
    const d = await load(N);
    const rec: any[] = []; const tap: any[] = [];
    d.notifications.onReceived((n: any) => rec.push(n)); d.notifications.onTapped((n: any) => tap.push(n));
    const request = { identifier: "x1", content: { title: "T", body: "B", data: { a: 1 } } };
    handlers.recv({ request }); handlers.tap({ notification: { request } });
    expect(rec).toEqual([{ id: "x1", title: "T", body: "B", data: { a: 1 } }]);
    expect(tap).toEqual(rec);
  });
  it("returns a no-op unsubscribe when the module is missing", async () => {
    const d = await load(null); expect(() => d.notifications.onReceived(() => {})()).not.toThrow();
  });
});
