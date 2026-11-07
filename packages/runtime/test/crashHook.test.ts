import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (e: unknown, isFatal?: boolean) => void;
const calls: string[] = [];
let handler: Handler;

async function load() {
  vi.resetModules();
  calls.length = 0;
  const prev = vi.fn(() => { calls.push("prev"); });
  handler = prev;
  const setGlobalHandler = vi.fn((h: Handler) => { handler = h; });
  (globalThis as any).ErrorUtils = { getGlobalHandler: () => handler, setGlobalHandler };
  (globalThis as any).__native = {
    getState: () => ({}), checkForUpdate: async () => ({ status: "none" }), consumeEvents: () => [],
    rollback: () => {}, reload: () => {},
    markHealthy: () => ({ release: 1, coldStartMs: 1, sinceLoadMs: 1, promoted: false }),
    noteCrash: () => { calls.push("noteCrash"); },
  };
  const { Runtime } = await import("../src/index");
  return { Runtime, setGlobalHandler, prev };
}

beforeEach(() => { delete (globalThis as any).ErrorUtils; delete (globalThis as any).__native; });

describe("crash hook", () => {
  it("calls noteCrash before the previous handler on a fatal error", async () => {
    const { Runtime, prev } = await load();
    Runtime.markHealthy();
    handler(new Error("boom"), true);
    expect(calls).toEqual(["noteCrash", "prev"]);
    expect(prev).toHaveBeenCalledOnce();
  });
  it("installs the hook once when markHealthy is called twice", async () => {
    const { Runtime, setGlobalHandler } = await load();
    Runtime.markHealthy(); Runtime.markHealthy();
    expect(setGlobalHandler).toHaveBeenCalledOnce();
  });
  it("does not call noteCrash for a non-fatal error, and still calls the previous handler", async () => {
    const { Runtime } = await load();
    Runtime.markHealthy();
    handler(new Error("warn"), false);
    expect(calls).toEqual(["prev"]);
  });
  it("installs the hook at load, so a fatal error before markHealthy calls noteCrash", async () => {
    const { setGlobalHandler, prev } = await load();
    expect(setGlobalHandler).toHaveBeenCalledOnce();
    handler(new Error("boom"), true);
    expect(calls).toEqual(["noteCrash", "prev"]);
    expect(prev).toHaveBeenCalledOnce();
  });
  it("installs nothing when the shell has no noteCrash", async () => {
    vi.resetModules();
    const setGlobalHandler = vi.fn();
    (globalThis as any).ErrorUtils = { getGlobalHandler: () => () => {}, setGlobalHandler };
    (globalThis as any).__native = { getState: () => ({}), markHealthy: () => ({}), consumeEvents: () => [] };
    await import("../src/index");
    expect(setGlobalHandler).not.toHaveBeenCalled();
  });
});
