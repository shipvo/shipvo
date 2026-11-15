import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { store } from "../src/store";
import { appCmd } from "../src/app";
import { sim } from "../src/sim";

const simMock = vi.hoisted(() => ({ spawn: null as null | ((args: string[]) => unknown) }));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawn: (_cmd: string, args: string[]) => simMock.spawn?.(args) }));
vi.mock("../src/ensure-playwright.js", () => ({ ensurePlaywright: () => undefined }));

const cwd = process.cwd();
let out: string[], err: string[], home: string;

async function run(fn: () => Promise<unknown>) {
  out = []; err = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.map(String).join(" ")); });
  process.exitCode = undefined;
  await fn();
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  expect(out).toHaveLength(1);
  const doc = JSON.parse(out[0]);
  expect(Object.keys(doc).sort()).toEqual(["code", "data", "next", "ok", "summary"]);
  expect(doc.next.length).toBeLessThanOrEqual(3);
  expect(doc.ok).toBe(code === 0);
  return { doc, code };
}

function appDir(signedIn = false) {
  const d = mkdtempSync(join(tmpdir(), "shipvo-jsa-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", name: "Shop", controlPlane: "https://cp.test/", publicKey: "AAAA" }));
  process.chdir(d);
  if (signedIn) writeFileSync(join(home, "credentials.json"), JSON.stringify({ key: "pn_live_X", control: "https://cp.test", mcp_url: "https://cp.test/mcp" }));
  return d;
}
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "shipvo-home-")); process.env.SHIPVO_HOME = home; });
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = undefined; delete process.env.SHIPVO_HOME; });

describe("store --json", () => {
  it("setup writes the plan and points at the first open step", async () => {
    appDir();
    const { doc, code } = await run(() => store(["setup", "--company", "no", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("plan_written");
    expect(doc.next[0].command).toContain("shipvo store status --mark");
  });
  it("status reports progress, and marking a step moves it", async () => {
    appDir();
    await run(() => store(["setup", "--company", "no", "--json"]));
    const first = (await run(() => store(["status", "--json"]))).doc;
    expect(first.code).toBe("in_progress"); expect(first.data.done).toBe(0);
    const step = first.data.steps[0].id;
    const second = (await run(() => store(["status", "--mark", step, "--json"]))).doc;
    expect(second.data.done).toBe(1);
  });
  it("status without a plan fails with no_plan and exit 2", async () => {
    appDir();
    const { doc, code } = await run(() => store(["status", "--json"]));
    expect(code).toBe(2); expect(doc.ok).toBe(false); expect(doc.code).toBe("no_plan");
    expect(doc.next[0].command).toContain("store setup");
  });
  it("status with an unknown step fails with unknown_step", async () => {
    appDir();
    await run(() => store(["setup", "--json"]));
    const { doc, code } = await run(() => store(["status", "--mark", "nope", "--json"]));
    expect(code).toBe(2); expect(doc.code).toBe("unknown_step");
  });
  it("details --dry-run writes the files and lists open questions", async () => {
    appDir();
    const { doc, code } = await run(() => store(["details", "--dry-run", "--out", "o", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("details_written"); expect(Array.isArray(doc.data.unknown)).toBe(true);
  });
  it("details without --dry-run is a usage error", async () => {
    appDir();
    const { doc, code } = await run(() => store(["details", "--json"]));
    expect(code).toBe(2); expect(doc.code).toBe("usage");
  });
  it("an unknown subcommand is a usage error", async () => {
    appDir();
    const { doc, code } = await run(() => store(["bogus", "--json"]));
    expect(code).toBe(2); expect(doc.code).toBe("usage");
  });
  it("testers prints the guide without a Play call", async () => {
    appDir();
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const { doc, code } = await run(() => store(["testers", "--package", "com.example.shop", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("testers_guide"); expect(f).not.toHaveBeenCalled();
  });
  it("testers with an unreadable key file fails with remote_failed", async () => {
    appDir();
    const { doc, code } = await run(() => store(["testers", "--play-key", "missing.json", "--json"]));
    expect(code).toBe(1); expect(doc.ok).toBe(false); expect(doc.code).toBe("remote_failed");
  });
  it("screenshots with an unsupported mode is a usage error", async () => {
    appDir();
    const { doc, code } = await run(() => store(["screenshots", "--mode", "native", "--json"]));
    expect(code).toBe(2); expect(doc.code).toBe("usage");
  });
});

describe("store screenshots --json", () => {
  const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]).toString("base64");
  const fakeSim = (wrongSize: boolean) => {
    let size = { width: 0, height: 0 };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.width) size = body;
      const data = wrongSize ? jpeg(100, 100) : jpeg(size.width, size.height);
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    }));
  };
  it("success reports screenshots_ready with the output folder", async () => {
    appDir(); fakeSim(false);
    process.exitCode = 1; // a stale value must not leak into the result
    const { doc, code } = await run(() => store(["screenshots", "--sim", "http://sim.test", "--out", "shots", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("screenshots_ready"); expect(doc.data.out).toBe("shots");
  });
  it("a wrong size fails with screenshots_failed and exit 1", async () => {
    appDir(); fakeSim(true);
    const { doc, code } = await run(() => store(["screenshots", "--sim", "http://sim.test", "--json"]));
    expect(code).toBe(1); expect(doc.ok).toBe(false); expect(doc.code).toBe("screenshots_failed");
  });
  it("outside an app folder fails with no_config and exit 1", async () => {
    process.chdir(mkdtempSync(join(tmpdir(), "shipvo-empty-")));
    const { doc, code } = await run(() => store(["details", "--dry-run", "--json"]));
    expect(code).toBe(1); expect(doc.code).toBe("no_config");
  });
});

describe("app --json", () => {
  it("fails with not_signed_in when there are no credentials", async () => {
    appDir();
    const { doc, code } = await run(() => appCmd(["list", "--json"]));
    expect(code).toBe(1); expect(doc.code).toBe("not_signed_in"); expect(doc.next[0].command).toContain("login");
  });
  it("list returns the apps", async () => {
    appDir(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ apps: [{ app_id: "shop", name: "Shop", bytes_used: 1048576 }] }), { status: 200 })));
    const { doc, code } = await run(() => appCmd(["list", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("listed"); expect(doc.data.count).toBe(1);
  });
  it("create registers the app and saves the token without printing it", async () => {
    appDir(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ app_id: "shop", created: true, publish_token: "SECRETTOKEN", expires_at: "2027-01-01T00:00:00Z", control_plane: "https://cp.test/" }), { status: 200 })));
    const { doc, code } = await run(() => appCmd(["create", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("created"); expect(doc.data.app_id).toBe("shop");
    expect([...out, ...err].join("\n")).not.toContain("SECRETTOKEN");
  });
  it("create fails with register_failed when the control plane refuses", async () => {
    appDir(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "name taken" }), { status: 409 })));
    const { doc, code } = await run(() => appCmd(["create", "--json"]));
    expect(code).toBe(1); expect(doc.code).toBe("register_failed");
  });
  it("delete without --yes is a usage error", async () => {
    appDir(true);
    const { doc, code } = await run(() => appCmd(["delete", "shop", "--json"]));
    expect(code).toBe(2); expect(doc.code).toBe("usage");
  });
  it("delete reports not_found for an unknown app", async () => {
    appDir(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const { doc, code } = await run(() => appCmd(["delete", "ghost", "--yes", "--json"]));
    expect(code).toBe(1); expect(doc.code).toBe("not_found");
  });
  it("delete succeeds", async () => {
    appDir(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ files_deleted: 3 }), { status: 200 })));
    const { doc, code } = await run(() => appCmd(["delete", "shop", "--yes", "--json"]));
    expect(code).toBe(0); expect(doc.code).toBe("deleted");
  });
});

describe("sim --json", () => {
  it("fails with a stable code when the port is taken", async () => {
    appDir();
    const { createServer } = await import("node:net");
    const s = createServer(); await new Promise<void>((r) => s.listen(0, r));
    const port = (s.address() as { port: number }).port;
    try {
      const { doc, code } = await run(() => sim(["--port", String(port), "--json"]));
      expect(code).toBe(1); expect(doc.ok).toBe(false); expect(doc.code).toBe("port_in_use");
    } finally { s.close(); }
  });
  it("fails with code failed outside an app folder", async () => {
    process.chdir(mkdtempSync(join(tmpdir(), "shipvo-empty-")));
    const { doc, code } = await run(() => sim(["--json"]));
    expect(code).toBe(1); expect(doc.ok).toBe(false); expect(doc.code).toBe("failed");
  });
  describe("with a stub simulator", () => {
    let listener: Server | undefined;
    function simApp() {
      const d = appDir();
      mkdirSync(join(d, "sim-dist"), { recursive: true }); writeFileSync(join(d, "sim-dist/index.html"), "<html></html>");
      const pkg = join(d, "node_modules/@shipvo/sim"); mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@shipvo/sim", version: "0.0.0" })); writeFileSync(join(pkg, "server.mjs"), "");
    }
    afterEach(() => { listener?.close(); listener = undefined; simMock.spawn = null; });
    it("prints one listening envelope", async () => {
      simApp();
      simMock.spawn = (args) => { listener = createServer(); listener.listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1"); return Object.assign(new EventEmitter(), { kill: () => true }); };
      const { createServer: probe } = await import("node:net");
      const p = probe(); await new Promise<void>((r) => p.listen(0, r)); const port = (p.address() as { port: number }).port; await new Promise((r) => p.close(r));
      const { doc, code } = await run(() => sim(["--port", String(port), "--skip-build", "--json"]));
      expect(code).toBe(0); expect(out).toHaveLength(1);
      expect(doc.code).toBe("listening");
      expect(doc.data).toMatchObject({ url: `http://localhost:${port}/app/`, port, app_id: "shop" });
    });
    it("fails with sim_exited when the child exits before listening", async () => {
      simApp();
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      simMock.spawn = () => { const e = Object.assign(new EventEmitter(), { kill: () => true }); setTimeout(() => e.emit("exit", 1), 20); return e; };
      const { doc, code } = await run(() => sim(["--port", "45987", "--skip-build", "--json"]));
      expect(code).toBe(1); expect(doc.ok).toBe(false); expect(doc.code).toBe("sim_exited");
      expect(exit).toHaveBeenCalled();
    });
  });
});
