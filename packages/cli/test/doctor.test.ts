import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64, keyFromSeed } from "../src/index";
import { doctor, runDoctorChecks } from "../src/doctor";

const nameOf = (results: Awaited<ReturnType<typeof runDoctorChecks>>, name: string) => results.find((r) => r.name === name)!;
const makeSeed = () => b64(Buffer.alloc(32, 7));
const makePub = (seed: string) => b64(keyFromSeed(seed).publicKey);

function withConfig(body: string, seed?: string) {
  const cwd = mkdtempSync(join(tmpdir(), "shipvo-doctor-"));
  writeFileSync(join(cwd, "shipvo.json"), body);
  if (seed) {
    mkdirSync(join(cwd, ".shipvo"), { recursive: true });
    writeFileSync(join(cwd, ".shipvo", "seed.txt"), seed);
  }
  return cwd;
}

describe("shipvo doctor checks", () => {
  it("--skip-sim leaves out the simulator checks", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", publicKey: makePub(seed) }), seed);
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { sim: "shipvo sim" } }));
    const chromiumPath = () => null;
    const withSim = await runDoctorChecks({ cwd, offline: true, chromiumPath });
    const skipped = await runDoctorChecks({ cwd, offline: true, chromiumPath, skipSim: true });
    expect(nameOf(withSim, "Playwright Chromium installed").ok).toBe(false);
    expect(skipped.some((r) => r.name === "Playwright Chromium installed" || r.name.startsWith("sim port"))).toBe(false);
  });

  it("--offline makes no network call and passes the two network checks", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const fetchFn = vi.fn(async () => { throw new Error("no network"); });
    const off = await runDoctorChecks({ cwd, offline: true, fetchFn: fetchFn as unknown as typeof fetch });
    const on = await runDoctorChecks({ cwd, fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalledTimes(2); // only the online run
    expect(nameOf(off, "control plane reachable")).toMatchObject({ ok: true, note: "skipped, --offline" });
    expect(nameOf(off, "control plane /health returns JSON").ok).toBe(true);
    expect(nameOf(on, "control plane reachable").ok).toBe(false);
  });

  it("passes Node version >= 22 and fails older Node", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const ok = await runDoctorChecks({ cwd, nodeVersion: "22.11.0", fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const bad = await runDoctorChecks({ cwd, nodeVersion: "20.11.0", fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "Node version (>=22)").ok).toBe(true);
    expect(nameOf(bad, "Node version (>=22)").ok).toBe(false);
  });

  it("passes and fails when shipvo.json cannot parse", async () => {
    const seed = makeSeed();
    const good = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const bad = withConfig("{ bad json", seed);
    const ok = await runDoctorChecks({ cwd: good, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd: bad, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "shipvo.json parses").ok).toBe(true);
    expect(nameOf(fail, "shipvo.json parses").ok).toBe(false);
  });

  it("passes and fails signing key match", async () => {
    const seed = makeSeed();
    const good = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const bad = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(b64(Buffer.alloc(32, 9))) }), seed);
    const ok = await runDoctorChecks({ cwd: good, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd: bad, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "signing key matches shipvo.json publicKey").ok).toBe(true);
    expect(nameOf(fail, "signing key matches shipvo.json publicKey").ok).toBe(false);
  });

  it("passes and fails control plane reachability", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const ok = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => { throw new Error("no route"); }) as typeof fetch });
    expect(nameOf(ok, "control plane reachable").ok).toBe(true);
    expect(nameOf(fail, "control plane reachable").ok).toBe(false);
  });

  it("passes and fails hermesBytecodeVersion when present", async () => {
    const seed = makeSeed();
    const okCwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed), hermesBytecodeVersion: [96, 98] }), seed);
    const failCwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed), hermesBytecodeVersion: "nope" }), seed);
    const ok = await runDoctorChecks({ cwd: okCwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd: failCwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "hermesBytecodeVersion (if present) is set").ok).toBe(true);
    expect(nameOf(fail, "hermesBytecodeVersion (if present) is set").ok).toBe(false);
  });

  it("never prints seed or token values", async () => {
    const seed = makeSeed();
    const token = "shipvo-publish-token-value";
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(b64(Buffer.alloc(32, 9))) }), seed);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.stubEnv("SHIPVO_PUBLISH_TOKEN", token);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok"));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(doctor([])).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(logs.join("\n")).not.toContain(seed);
    expect(logs.join("\n")).not.toContain(token);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails the signing check, without crashing, when the seed file is missing", async () => {
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(makeSeed()) }));
    const r = await runDoctorChecks({ cwd, env: { SHIPVO_SIGNING_SEED_FILE: "/nope" }, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(r).toHaveLength(7);
    expect(nameOf(r, "signing key matches shipvo.json publicKey").ok).toBe(false);
    expect(nameOf(r, "control plane reachable").ok).toBe(true);
  });

  it("passes a timeout signal to fetch and fails when it aborts", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const fetchFn = vi.fn(async (_u: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("timed out", "TimeoutError");
    });
    const r = await runDoctorChecks({ cwd, fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalled();
    expect(nameOf(r, "control plane reachable").ok).toBe(false);
  });

  it("fails control plane check on HTTP 503 and says so", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const r = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch });
    const c = nameOf(r, "control plane reachable");
    expect(c.ok).toBe(false);
    expect(c.fix).toContain("503");
  });

  it("treats empty or null hermesBytecodeVersion as not declared", async () => {
    const seed = makeSeed();
    for (const v of ["", null]) {
      const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed), hermesBytecodeVersion: v }), seed);
      const r = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
      expect(nameOf(r, "hermesBytecodeVersion (if present) is set").ok).toBe(true);
    }
  });

  it("points at shipvo.json when it is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "shipvo-doctor-"));
    const r = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(r, "signing key matches shipvo.json publicKey").fix).toContain("shipvo.json first");
    expect(nameOf(r, "control plane reachable").fix).toContain("shipvo.json first");
  });

  it("prints PASS lines without a fix and does not print the seed on an all-pass run", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    chmodSync(join(cwd, ".shipvo", "seed.txt"), 0o600);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => String(u).endsWith("/health") ? Response.json({ ok: true }) : new Response("ok"));
    await doctor([]);
    expect(exit).not.toHaveBeenCalled();
    const out = logs.join("\n");
    expect(out).toContain("PASS control plane reachable");
    expect(out).not.toContain("fix: none");
    expect(out).not.toContain(seed);
    vi.restoreAllMocks();
  });

  it("exits 2 on extra arguments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(doctor(["extra"])).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(2);
    vi.restoreAllMocks();
  });

  describe("key file permissions", () => {
    const keyCheck = (cwd: string, extra = {}) => runDoctorChecks({ cwd, env: {}, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch, ...extra }).then((r) => nameOf(r, "signing key file is private"));
    const setup = (mode: number) => {
      const seed = makeSeed();
      const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
      chmodSync(join(cwd, ".shipvo", "seed.txt"), mode);
      return cwd;
    };
    it.skipIf(process.platform === "win32")("passes 0600", async () => {
      expect((await keyCheck(setup(0o600))).ok).toBe(true);
    });
    it.skipIf(process.platform === "win32")("fails 0644 with a chmod hint and no key contents", async () => {
      const c = await keyCheck(setup(0o644));
      expect(c.ok).toBe(false);
      expect(c.fix).toContain("chmod 600");
      expect(c.fix).not.toContain(makeSeed());
    });
    it("skips on Windows with a note", async () => {
      const c = await keyCheck(setup(0o644), { platform: "win32" });
      expect(c.ok).toBe(true);
      expect(c.note).toContain("Windows");
    });
  });

  describe("control plane health", () => {
    const run = (fetchFn: unknown) => {
      const seed = makeSeed();
      const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com/", publicKey: makePub(seed) }), seed);
      return runDoctorChecks({ cwd, fetchFn: fetchFn as typeof fetch }).then((r) => nameOf(r, "control plane /health returns JSON"));
    };
    it("passes on 200 JSON and requests /health", async () => {
      const f = vi.fn(async () => Response.json({ ok: true }));
      expect((await run(f)).ok).toBe(true);
      expect(f.mock.calls.some((c) => (c as unknown[])[0] === "https://example.com/health")).toBe(true);
    });
    it("fails on non-200", async () => {
      const c = await run(async () => new Response("{}", { status: 404 }));
      expect(c.ok).toBe(false);
      expect(c.fix).toContain("404");
    });
    it("fails on timeout", async () => {
      const c = await run(async () => { throw new DOMException("t", "TimeoutError"); });
      expect(c.ok).toBe(false);
      expect(c.fix).toContain("5 seconds");
    });
    it("fails on non-JSON", async () => {
      const c = await run(async () => new Response("<html>"));
      expect(c.ok).toBe(false);
      expect(c.fix).toContain("not JSON");
    });
  });
});

describe("shipvo doctor sim checks", () => {
  const withSim = (sim: boolean) => {
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: "x" }));
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: sim ? { sim: "shipvo sim" } : {} }));
    return cwd;
  };
  const run = (cwd: string, o: object = {}) => runDoctorChecks({ cwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch, ...o });

  it("Chromium check passes when the binary exists and fails with the fix when not", async () => {
    const cwd = withSim(true);
    const bin = join(cwd, "chrome");
    writeFileSync(bin, "");
    expect(nameOf(await run(cwd, { chromiumPath: () => bin }), "Playwright Chromium installed").ok).toBe(true);
    const missing = nameOf(await run(cwd, { chromiumPath: () => join(cwd, "nope") }), "Playwright Chromium installed");
    expect(missing.ok).toBe(false);
    expect(missing.fix.endsWith("npx playwright install chromium")).toBe(true);
    expect(nameOf(await run(cwd, { chromiumPath: () => null }), "Playwright Chromium installed").ok).toBe(false);
  });

  it("port check passes on a free port and fails on a real busy one", async () => {
    const { createServer } = await import("node:net");
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, r));
    const busy = (srv.address() as { port: number }).port;
    const cwd = withSim(true);
    const fail = nameOf(await run(cwd, { port: busy }), `sim port ${busy} is free`);
    expect(fail.ok).toBe(false);
    expect(fail.fix.endsWith("Stop the other process or pass --port <n>")).toBe(true);
    await new Promise((r) => srv.close(r));
    expect(nameOf(await run(cwd, { port: busy }), `sim port ${busy} is free`).ok).toBe(true);
  });

  it("skips both checks without a sim script", async () => {
    const names = (await run(withSim(false))).map((r) => r.name);
    expect(names.some((n) => n.includes("Chromium") || n.includes("sim port"))).toBe(false);
  });

  it("exits non-zero when a sim check fails", async () => {
    const cwd = withSim(true);
    const prev = process.cwd();
    process.chdir(cwd);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    try { await expect(doctor([])).rejects.toThrow("exit"); expect(exit).toHaveBeenCalledWith(1); }
    finally { process.chdir(prev); vi.restoreAllMocks(); }
  });

  it.each([["foo"], ["--port", "abc"], ["--port", "4545", "4545"]])("rejects bad arguments %j with exit 2", async (...argv) => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try { await expect(doctor(argv)).rejects.toThrow("exit"); expect(exit).toHaveBeenCalledWith(2); }
    finally { vi.restoreAllMocks(); }
  });

  it("default portFree sees a real busy port", async () => {
    const { portFree } = await import("../src/sim.js");
    const { createServer } = await import("node:net");
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, r));
    const busy = (srv.address() as { port: number }).port;
    expect(await portFree(busy)).toBe(false);
    await new Promise((r) => srv.close(r));
    expect(await portFree(busy)).toBe(true);
  });
});
