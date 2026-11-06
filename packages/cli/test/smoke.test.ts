import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeCheck } from "../src/smoke";
import { args } from "../src/config";
import type { Driver } from "../src/explore";

const dir = mkdtempSync(join(tmpdir(), "shipvo-smoke-"));
writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "demo", controlPlane: "http://x", publicKey: "k" }));
const inDir = async <T>(f: () => Promise<T>) => { const prev = process.cwd(); process.chdir(dir); try { return await f(); } finally { process.chdir(prev); } };
const TREE = '- button "Go" [ref=e1]\n- text "Hi" [ref=e2]';
const fake = (o: { screen?: string; errors?: string[]; hang?: boolean }) => ({
  start: async () => ({ base: "http://sim", stop: () => {} }),
  driver: () => ({ open: async () => (o.hang ? new Promise<never>(() => {}) : { ok: true, screen: o.screen ?? TREE }), errors: async () => o.errors ?? [] }) as unknown as Driver,
  screen: async () => o.screen ?? TREE,
});

describe("smoke (fake simulator)", () => {
  it("ok: exit 0, envelope shape", async () => {
    const { doc, exit } = await inDir(() => smokeCheck(["--json"], fake({})));
    expect(exit).toBe(0);
    expect(doc).toMatchObject({ ok: true, code: "ok", data: { elements: 2, errors: [], error_count: 0 } });
    expect(Object.keys(doc).sort()).toEqual(["code", "data", "next", "ok", "summary"]);
    expect(doc.summary).toMatch(/^The app loads/);
  });
  it.each([["android", []], ["android", ["android"]], ["ios", ["ios"]]])("platform %s reaches the driver (args %j)", async (want, argv) => {
    let got: string | undefined;
    const d = fake({});
    const { doc, exit } = await inDir(() => smokeCheck([...argv, "--json"], { ...d, driver: ((_b: string, _a: string, _s: string, p: string) => { got = p; return d.driver(); }) as any }));
    expect(exit).toBe(0); expect(got).toBe(want);
    expect((doc.data as any).platform).toBe(want);
    expect(doc.summary).toContain(`on ${want}`);
  });
  it("bad platform: exit 2 with a next entry, sim never started", async () => {
    let started = false;
    const { doc, exit } = await inDir(() => smokeCheck(["windows"], { ...fake({}), start: async () => { started = true; return { base: "x", stop() {} }; } }));
    expect(exit).toBe(2); expect(started).toBe(false); expect(doc.next.length).toBeGreaterThan(0);
  });
  it("a flag value is not taken as the platform", async () => {
    expect((await inDir(() => smokeCheck(["--timeout", "5", "ios"], fake({})))).doc.data).toMatchObject({ platform: "ios" });
  });
  it("simDriver sends the platform as the session device", async () => {
    const { simDriver } = await import("../src/explore");
    const bodies: any[] = []; const f = globalThis.fetch;
    globalThis.fetch = (async (_u: any, i: any) => { bodies.push(JSON.parse(i.body)); return { ok: true, json: async () => ({ ok: true }) }; }) as any;
    try { await simDriver("http://s", "demo", "x", "ios").open(); } finally { globalThis.fetch = f; }
    expect(bodies[0]).toMatchObject({ session: "x", app: "demo", device: { platform: "ios" } });
  });
  it("errors: exit 1, first 5 in data.errors", async () => {
    const errors = Array.from({ length: 7 }, (_, i) => `boom ${i}`);
    const { doc, exit } = await inDir(() => smokeCheck([], fake({ errors })));
    expect(exit).toBe(1);
    expect((doc.data as any).errors).toEqual(errors.slice(0, 5));
    expect((doc.data as any).error_count).toBe(7);
  });
  it("no elements: exit 1", async () => {
    const { doc, exit } = await inDir(() => smokeCheck([], fake({ screen: "" })));
    expect(exit).toBe(1); expect(doc.code).toBe("empty_screen");
  });
  it("timeout: exit 1", async () => {
    const { doc, exit } = await inDir(() => smokeCheck(["--timeout", "0.2"], fake({ hang: true })));
    expect(exit).toBe(1); expect(doc.code).toBe("timeout");
  });
  it("bad timeout and no shipvo.json: exit 2", async () => {
    expect((await inDir(() => smokeCheck(["--timeout", "abc"], fake({})))).exit).toBe(2);
    const prev = process.cwd(); process.chdir(tmpdir());
    try { expect((await smokeCheck([], fake({}))).exit).toBe(2); } finally { process.chdir(prev); }
  });
  it("browser missing: exit 2 with the install command in next", async () => {
    const { doc, exit } = await inDir(() => smokeCheck([], { ...fake({}), start: async () => { throw new Error("playwright is not installed and SHIPVO_NO_AUTO_INSTALL=1 is set."); } }));
    expect(exit).toBe(2);
    expect(doc.next[0].command).toMatch(/install .*playwright/);
  });
  it("--json does not swallow a following word", () => {
    expect(args(["--json", "x"])).toEqual({ json: "true" });
  });
});

// Real simulator, when a browser is available.
const require_ = createRequire(import.meta.url);
const simServer = require_.resolve("@shipvo/sim/server.mjs");
let chromium = false;
try { chromium = existsSync(require_("playwright").chromium.executablePath()); } catch {}
const PAGES = {
  ok: '<!doctype html><html><body><button>Hello</button></body></html>',
  throws: '<!doctype html><html><body><button>Hi</button><script>throw new Error("fixture threw on load")</script></body></html>',
  reject: '<!doctype html><html><body><button>Hi</button><script>Promise.reject(new Error("fixture rejected"))</script></body></html>',
};
describe.skipIf(!chromium)("smoke (real simulator)", () => {
  const base = 47000 + Math.floor(Math.random() * 2000) * 3;
  const ports: Record<string, number> = { ok: base, throws: base + 1, reject: base + 2 };
  const procs: ChildProcess[] = [];
  beforeAll(async () => {
    for (const [k, html] of Object.entries(PAGES)) {
      const d = join(dir, k); mkdirSync(join(d, "dist"), { recursive: true }); writeFileSync(join(d, "dist", "index.html"), html);
      procs.push(spawn(process.execPath, [simServer, "--port", String(ports[k]), "--app", "demo", "--dir", join(d, "state"), "--dist", join(d, "dist")], { stdio: ["ignore", "ignore", "inherit"], cwd: dirname(simServer) }));
    }
    for (const p of Object.values(ports)) for (let i = 0; i < 300; i++) { try { await fetch(`http://localhost:${p}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  }, 90000);
  afterAll(() => { for (const p of procs) p.kill("SIGKILL"); });
  it("passes on a page that loads", async () => {
    const { doc, exit } = await inDir(() => smokeCheck(["--sim", `http://localhost:${ports.ok}`, "--json"]));
    expect(doc.summary).toMatch(/^The app loads/); expect(exit).toBe(0);
  }, 60000);
  it.each([["throws", "fixture threw on load"], ["reject", "fixture rejected"]])("%s: exit 1 with the error text", async (k, text) => {
    const { doc, exit } = await inDir(() => smokeCheck(["--sim", `http://localhost:${ports[k]}`, "--json"]));
    expect(exit).toBe(1);
    expect((doc.data as any).errors.join("\n")).toContain(text);
  }, 60000);
});
