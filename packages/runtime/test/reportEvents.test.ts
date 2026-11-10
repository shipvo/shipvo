import { Telemetry } from "../../schema/src/index";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queue: string[] = [];
async function load(opts: { fail?: boolean; extra?: any } = {}) {
  vi.resetModules();
  queue.length = 0;
  const fetchMock = vi.fn(async (_u: string, _i: any) => { if (opts.fail) throw new Error("offline"); return { ok: true }; });
  (globalThis as any).fetch = fetchMock;
  (globalThis as any).__native = {
    getState: () => ({ baseUrl: "https://cp.test", appId: "app1", runningRelease: 4 }),
    checkForUpdate: async () => { queue.push("pointer_rejected:native_module_missing", "hermes_bytecode_mismatch:9"); return { status: "none", reason: "hermes_bytecode_mismatch" }; },
    consumeEvents: () => queue.splice(0),
    markHealthy: () => { queue.push("crash_loop_revert"); return { release: 4, coldStartMs: 1, sinceLoadMs: 0, promoted: false }; },
    rollback: () => {}, reload: () => {},
  };
  const mod = await import("../src/index");
  return { ...mod, fetchMock };
}
const sent = (f: any) => f.mock.calls.map((c: any[]) => JSON.parse(c[1].body));

beforeEach(() => { delete (globalThis as any).__native; });

describe("event reporting", () => {
  it("sends a hermes_bytecode_mismatch queued during checkForUpdate in the same session", async () => {
    const { Runtime, fetchMock } = await load();
    await Runtime.checkForUpdate(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://cp.test/t");
    expect(sent(fetchMock).map((b: any) => [b.event, b.release, b.app_id])).toEqual([
      ["native_module_missing", 4, "app1"], ["hermes_bytecode_mismatch", 9, "app1"]]);
  });
  it("reports events after markHealthy", async () => {
    const { Runtime, fetchMock } = await load();
    Runtime.markHealthy();
    expect(sent(fetchMock).map((b: any) => b.event)).toEqual(["crash_loop_revert"]);
  });
  it("sends load_kind with a crash_loop_revert", async () => {
    const { reportRuntimeEvents, fetchMock } = await load();
    queue.push("crash_loop_revert:4:reload");
    reportRuntimeEvents();
    const [body] = sent(fetchMock);
    expect(body.load_kind).toBe("reload");
    expect(Telemetry.safeParse(body).success).toBe(true);
  });
  it("does not throw or drop other events when fetch rejects", async () => {
    const { Runtime, fetchMock } = await load({ fail: true });
    await expect(Runtime.checkForUpdate(true)).resolves.toMatchObject({ status: "none" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not throw when fetch throws synchronously", async () => {
    const { reportRuntimeEvents, fetchMock } = await load();
    fetchMock.mockImplementation(() => { throw new Error("boom"); });
    queue.push("verify_failed:3", "rolled_back");
    expect(() => reportRuntimeEvents()).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("tells listeners about the drained events", async () => {
    const { reportRuntimeEvents, onRuntimeEvents } = await load();
    const seen: string[][] = [];
    onRuntimeEvents((e) => seen.push(e));
    queue.push("rolled_back");
    reportRuntimeEvents();
    expect(seen).toEqual([["rolled_back"]]);
  });
  it("sends a payload that passes the Telemetry schema", async () => {
    const { Runtime, fetchMock } = await load();
    await Runtime.checkForUpdate(true);
    Runtime.markHealthy();
    const bodies = sent(fetchMock);
    expect(bodies.length).toBe(3);
    for (const b of bodies) expect(Telemetry.safeParse(b).success).toBe(true);
  });
  it("reports when native.checkForUpdate rejects", async () => {
    const { Runtime, fetchMock } = await load();
    (globalThis as any).__native.checkForUpdate = async () => { queue.push("verify_failed:7"); throw new Error("net"); };
    vi.resetModules();
    const { Runtime: R2 } = await import("../src/index");
    await expect(R2.checkForUpdate(true)).rejects.toThrow("net");
    expect(sent(fetchMock).map((b: any) => [b.event, b.release])).toEqual([["verify_failed", 7]]);
  });
  it("does not send automatically when reportEvents is false", async () => {
    const { fetchMock } = await load();
    const req = createRequire(import.meta.url); const id = req.resolve("expo-constants");
    const saved = req.cache[id]; req.cache[id] = { id, exports: { default: { expoConfig: { extra: { shipvo: { reportEvents: false } } } } }, loaded: true } as any;
    vi.resetModules();
    const { Runtime: R2, reportRuntimeEvents } = await import("../src/index");
    R2.markHealthy();
    expect(fetchMock).not.toHaveBeenCalled();
    queue.push("rolled_back");
    reportRuntimeEvents();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (saved) req.cache[id] = saved; else delete req.cache[id];
  });
});
