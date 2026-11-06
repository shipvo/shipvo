import { test, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

// Tests set `globalThis.__native` before the runtime is imported (see the runtime's stub).
const queue: string[] = [];
async function load() {
  vi.resetModules();
  queue.length = 0;
  (globalThis as any).__native = {
    getState: () => ({ baseUrl: "https://cp.test", appId: "tide", runningRelease: 4 }),
    consumeEvents: () => queue.splice(0),
    checkForUpdate: async () => ({ status: "none" }), markHealthy: () => ({}), rollback() {}, reload() {},
  };
  const tel = await import("../src/telemetry");
  const rt = await import("@shipvo/runtime");
  return { tel, rt };
}

function verify(sent: string, key: string) {
  const m = /,"sig":"([0-9a-f]{64})"\}$/.exec(sent)!;
  expect(m).not.toBeNull();
  const unsigned = sent.slice(0, m.index) + "}";
  expect(createHmac("sha256", key).update(unsigned).digest("hex")).toBe(m[1]);
  return JSON.parse(sent);
}

let sent: { url: string; body: string }[] = [];
let registerStatus = 200;
let registered: any[] = [];
beforeEach(() => {
  sent = []; registered = []; registerStatus = 200;
  globalThis.fetch = (async (url: string, init?: any) => {
    sent.push({ url, body: init?.body ?? "" });
    if (url.endsWith("/t/register")) {
      // The real contract (services/control-plane/src/installs.ts): app_id, a valid install_id and shell_version.
      let b: any = {}; try { b = JSON.parse(init?.body ?? "{}"); } catch {}
      const ok = typeof b.app_id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(b.app_id)
        && typeof b.install_id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(b.install_id)
        && typeof b.shell_version === "string" && b.shell_version.length > 0 && b.shell_version.length <= 40;
      if (!ok) return new Response('{"error":"bad_register"}', { status: 400 });
      registered.push(b);
      return new Response(registerStatus === 200 ? JSON.stringify({ key: "k-secret" }) : "no", { status: registerStatus });
    }
    return new Response("{}");
  }) as any;
});
const flush = () => new Promise((r) => setTimeout(r, 20));

test("portableCrypto: hmac matches node:crypto, random bytes have the right length", async () => {
  const { tel } = await load();
  const c = tel.portableCrypto();
  const key = new TextEncoder().encode("k-secret"), data = new TextEncoder().encode('{"a":1}');
  expect(Buffer.from(await c.hmacSha256(key, data)).toString("hex")).toBe(createHmac("sha256", "k-secret").update(data).digest("hex"));
  expect((await c.randomBytes(16)).length).toBe(16);
});

test("portableCrypto: random bytes fall back to Math.random without crypto.getRandomValues", async () => {
  const { tel } = await load();
  const orig = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try { expect((await tel.portableCrypto().randomBytes(16)).length).toBe(16); }
  finally { if (orig) Object.defineProperty(globalThis, "crypto", orig); }
});

test("fileStorage falls back to memory when expo-file-system is missing", async () => {
  const { tel } = await load();
  const s = tel.fileStorage();
  expect(await s.getItem("k")).toBeNull();
  await s.setItem("k", "v");
  expect(await s.getItem("k")).toBe("v");
});

test("app reports and runtime events are signed with one identity, registered once", async () => {
  const { tel, rt } = await load();
  const st = memory();
  const r = tel.createReporter("https://cp.test", st, tel.portableCrypto());
  const body = verify(await r.body({ schema_version: "1.0", event: "applied", release: 3 }), "k-secret");
  expect(body.event).toBe("applied");

  queue.push("crash_loop_revert");
  rt.reportRuntimeEvents();
  await flush();
  const t = sent.filter((s) => s.url === "https://cp.test/t");
  expect(t).toHaveLength(1);
  const ev = verify(t[0].body, "k-secret");
  expect(ev.install_id).toBe(body.install_id);
  expect(sent.filter((s) => s.url.endsWith("/t/register"))).toHaveLength(1);
  expect(st.m.size).toBe(1);
});

test("registration sends app_id and shell_version, which the server requires", async () => {
  const { tel } = await load();
  const r = tel.createReporter("https://cp.test", memory(), tel.portableCrypto());
  verify(await r.body({ event: "applied" }), "k-secret");
  expect(registered).toHaveLength(1);
  expect(registered[0].app_id).toBe("tide");
  expect(registered[0].shell_version.length).toBeGreaterThan(0);
});

test("a failed registration goes out unsigned and is not retried in the same launch", async () => {
  const { tel } = await load();
  const r = tel.createReporter("https://cp.test", memory(), tel.portableCrypto());
  registerStatus = 503;
  expect(await r.body({ event: "applied" })).toBe('{"event":"applied"}');
  registerStatus = 200;
  expect(await r.body({ event: "applied" })).toBe('{"event":"applied"}');
  expect(registered).toHaveLength(1);
});

test("fileStorage creates the file, awaits the write, and reads it back", async () => {
  const files = new Map<string, string>();
  vi.doMock("expo-file-system", () => ({
    Paths: { document: "/doc" },
    File: class { path: string; constructor(d: string, n: string) { this.path = `${d}/${n}`; }
      get exists() { return files.has(this.path); }
      create() { files.set(this.path, ""); }
      textSync() { return files.get(this.path)!; }
      async write(v: string) { if (!files.has(this.path)) throw new Error("not created"); await Promise.resolve(); files.set(this.path, v); } },
  }));
  const { tel } = await load();
  const s = tel.fileStorage();
  expect(await s.getItem("k")).toBeNull();
  await s.setItem("k", "v");
  expect(await s.getItem("k")).toBe("v");
  vi.doUnmock("expo-file-system");
});

test("a failed save does not cause a second registration", async () => {
  const { tel } = await load();
  const bad = { getItem: () => null, setItem: () => { throw new Error("disk"); } };
  const r = tel.createReporter("https://cp.test", bad, tel.portableCrypto());
  verify(await r.body({ event: "a" }), "k-secret");
  verify(await r.body({ event: "b" }), "k-secret");
  expect(registered).toHaveLength(1);
});

test("postJson signs /t reports but leaves /o orders unsigned", async () => {
  const { tel } = await load();
  const reporter = tel.createReporter("https://cp.test", memory(), tel.portableCrypto());
  const fetchFn = (async (url: string, init: any) => { sent.push({ url, body: init.body }); return new Response("{}"); }) as any;
  await tel.postJson("https://cp.test", "/t", { event: "applied" }, true, fetchFn, () => reporter);
  await tel.postJson("https://cp.test", "/o/tide", { order: { id: 1 } }, false, fetchFn, () => reporter);
  const t = sent.find((s) => s.url === "https://cp.test/t")!;
  verify(t.body, "k-secret");
  expect(sent.find((s) => s.url === "https://cp.test/o/tide")!.body).toBe('{"order":{"id":1}}');
  await tel.postJson(undefined, "/t", {}, true, fetchFn, () => reporter); // no base URL: nothing sent
  expect(sent.filter((s) => s.url.endsWith("/t") || s.url.includes("/o/"))).toHaveLength(2);
});

test("signedBody falls back to plain JSON without an identity", async () => {
  const { tel } = await load();
  expect(await tel.signedBody(null, { a: 1 }, tel.portableCrypto())).toBe('{"a":1}');
});
