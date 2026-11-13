import http from "node:http";
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
vi.mock("node:child_process", async (orig) => {
  const m = await orig<typeof import("node:child_process")>();
  return { ...m, spawnSync: vi.fn((...a: Parameters<typeof m.spawnSync>) => (process.env.RUN_TEST_FAKE_NATIVE ? ({ status: 0 } as never) : m.spawnSync(...a))) };
});
import { renderFrame } from "../../sim/frame.mjs";
import { parseRunArgs, nativeCommand, runFramePage, loadFrameRenderer, startRunServer, hasRouter, buildBase, describeWebBuildFailure, buildWeb, run, lanAddress, isFirstBuild } from "../src/run";

describe("parseRunArgs", () => {
  it("parses platform and flags", () => {
    expect(parseRunArgs(["android"])).toEqual({ platform: "android", open: true, port: undefined, native: false, lan: false });
    expect(parseRunArgs(["ios", "--no-open", "--port", "5000", "--native"])).toEqual({ platform: "ios", open: false, port: 5000, native: true, lan: false });
    expect(parseRunArgs(["ios", "--lan"]).lan).toBe(true);
    expect(parseRunArgs(["--no-open", "ios"]).platform).toBe("ios");
  });
  it("rejects bad input", () => {
    expect(() => parseRunArgs([])).toThrow(/android or shipvo run ios/);
    expect(() => parseRunArgs(["windows"])).toThrow(/Unknown argument/);
    expect(() => parseRunArgs(["ios", "--port", "abc"])).toThrow(/--port/);
    expect(() => parseRunArgs(["ios", "--port"])).toThrow(/--port/);
  });
});

describe("run --help", () => {
  it("prints usage and exits 0 for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const out: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
      try { expect(await run([flag])).toBe(0); } finally { spy.mockRestore(); }
      expect(out.join("\n")).toMatch(/Usage: shipvo run android\|ios[\s\S]*--no-open[\s\S]*--port <n>[\s\S]*--native/);
    }
  });
  it("tells a missing platform how to fix it", () => {
    expect(() => parseRunArgs([])).toThrow(/Try: shipvo run android/);
  });
  it("detects a first build by the missing sim-dist", () => {
    const d = mkdtempSync(join(tmpdir(), "run-fb-"));
    expect(isFirstBuild(d)).toBe(true);
    mkdirSync(join(d, "sim-dist"));
    expect(isFirstBuild(d)).toBe(false);
  });
});

describe("--native", () => {
  it("builds the expo run command", () => {
    expect(nativeCommand("android")).toEqual({ cmd: "npx", args: ["expo", "run:android"] });
    expect(nativeCommand("ios")).toEqual({ cmd: "npx", args: ["expo", "run:ios"] });
  });
});

describe("frame page", () => {
  it("has the Android frame", () => {
    const h = runFramePage("android", "Tide", renderFrame);
    expect(h).toContain("412px"); expect(h).toContain("915px");
    expect(h).toContain('data-part="punch-hole"'); expect(h).toContain('data-part="gesture-bar"');
    expect(h).not.toContain("dynamic-island"); expect(h).toContain("Simulated"); expect(h).toContain("While using the app");
    expect(h).toContain('data-part="system-sheet"'); expect(h).toContain("Don't allow"); expect(h).toContain("shipvo:system-sheet");
  });
  it("has the iOS frame", () => {
    const h = runFramePage("ios", "Tide", renderFrame);
    expect(h).toContain("393px"); expect(h).toContain("852px");
    expect(h).toContain('data-part="dynamic-island"'); expect(h).toContain('data-part="home-indicator"');
    expect(h).not.toContain("punch-hole"); expect(h).toContain("Allow While Using App");
  });
  it("adds Lumi's first-run guide only when Lumi is on", () => {
    const withLumi = (lumi: boolean) => ((o: any) => renderFrame({ ...o, lumi })) as any;
    expect(runFramePage("android", "Tide", withLumi(true))).toContain('data-part="lumi-guide"');
    expect(runFramePage("android", "Tide", withLumi(false))).not.toContain('data-part="lumi-guide"');
  });
});

describe("frame page, live status bar", () => {
  it("inlines the status script when the renderer has one, and not otherwise", async () => {
    const sim = await import("../../sim/frame.mjs");
    const render = Object.assign((o: any) => sim.renderFrame(o), { statusScript: sim.statusClientScript }) as any;
    const h = runFramePage("android", "Tide", render);
    expect(h).toContain("pn:status"); expect(h).toContain('getElementById("app")');
    expect(runFramePage("android", "Tide", renderFrame)).not.toContain("pn:status");
  });
});

describe("describeWebBuildFailure, npm refusals", () => {
  it("says which Node version the app needs when npm refuses to run the build", () => {
    const out = 'npm error code EBADDEVENGINES\nnpm error EBADDEVENGINES Invalid devEngines.runtime\nnpm error EBADDEVENGINES Invalid semver version "^24.22.1" does not match "v22.23.4" for "runtime"\nnpm error A complete log of this run can be found in: /root/.npm/_logs/x-debug-0.log';
    expect(describeWebBuildFailure(out)).toBe("The app needs Node ^24.22.1 and this machine runs Node 22.23.4. Switch to that Node version, then start again.");
  });
  it("says what to add when the app is not set up to build for web with Metro", () => {
    const msg = describeWebBuildFailure('CommandError: Platform "web" is not configured to use the Metro bundler in the project Expo config.');
    expect(msg).toContain('"web": { "bundler": "metro" }');
    expect(msg).not.toContain("--native");
  });
  it("quotes a compile error and its file, not a line from the stack trace", () => {
    const out = "Bundling\nSyntaxError: node_modules/react-native-reanimated/lib/index.web.js: /home/me/app/node_modules/react-native-reanimated/lib/index.web.js: Export namespace should be first transformed by `@babel/plugin-proposal-export-namespace-from`.\n    at File.buildCodeFrameError (/home/me/app/node_modules/@babel/core/lib/transformation/file/file.js:205:12)\n    at emit (node:internal/child_process:949:14)";
    expect(describeWebBuildFailure(out)).toBe("The app cannot build for web (in node_modules/react-native-reanimated/lib/index.web.js): Export namespace should be first transformed by `@babel/plugin-proposal-export-namespace-from`.");
  });
  it("quotes the line that says what went wrong, not npm's pointer to its log file", () => {
    const msg = describeWebBuildFailure("npm error code E404\nnpm error 404 Not Found - GET https://registry.example/expo\nnpm error A complete log of this run can be found in: /root/.npm/_logs/x-debug-0.log");
    expect(msg).toContain("404 Not Found");
    expect(msg).not.toContain("complete log");
  });
});

describe("frame page, shared renderer", () => {
  it("uses the sim frame body, with light and dark status text and no badge on the phone", () => {
    for (const p of ["android", "ios"] as const) {
      const l = runFramePage(p, "Tide", renderFrame), d = runFramePage(p, "Tide", renderFrame, true);
      expect(l).toContain('data-part="phone-body"'); expect(l).not.toContain("simulated-label");
      expect(l).toContain("--sf-fg:#111"); expect(d).toContain("--sf-fg:#fff");
      expect(l).toContain('<iframe id="app" src="/app/"'); expect(l).toContain("scale(");
    }
  });
  it("keeps the label and sheet button in one wrapping row, and reserves room for the error bar above the phone", () => {
    const h = runFramePage("android", "Tide", renderFrame);
    expect(h).toContain('<div class="top" id="top"><div class="tag"');
    expect(h).toMatch(/\.tag\{[^}]*overflow-wrap:anywhere/);
    expect(h).not.toMatch(/\.tag\{position:fixed/);
    expect(h).toMatch(/\.banner\{position:fixed;[^}]*top:10px/);
    expect(h).toContain("top=bt+b.offsetHeight+10");
    expect(h).toContain("window.fit&&fit()");
  });
  it("loadFrameRenderer resolves @shipvo/sim and returns a function", async () => {
    // @shipvo/sim is not linked into the CLI package, so point at the sim package, which can resolve its own export.
    const sim = join(dirname(fileURLToPath(import.meta.url)), "../../sim/package.json");
    expect(typeof await loadFrameRenderer([sim])).toBe("function");
  });
  it("loadFrameRenderer says how to install @shipvo/sim when it is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "noSim-"));
    await expect(loadFrameRenderer([join(dir, "package.json")])).rejects.toThrow(/npm i -D @shipvo\/sim/);
  });
});

describe("server", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  it("serves the frame page and the export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "<p>the app</p>");
    mkdirSync(join(dir, "_expo"));
    writeFileSync(join(dir, "_expo", "a.js"), "1");
    const s = await startRunServer({ dir, platform: "ios", name: "Tide", render: renderFrame });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect(await (await fetch(base + "/")).text()).toContain("dynamic-island");
    expect(await (await fetch(base + "/app/")).text()).toBe("<p>the app</p>");
    const js = await fetch(base + "/_expo/a.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await fetch(base + "/nope")).status).toBe(404);
    expect((await fetch(base + "/..%2f..%2fetc/passwd")).status).toBeGreaterThanOrEqual(403);
  });
  it("an app with a router sees its own routes, and the frame's page loads go back to the app", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "<html><head><title>x</title></head><body>the app</body></html>");
    const project = mkdtempSync(join(tmpdir(), "run-proj-"));
    writeFileSync(join(project, "package.json"), JSON.stringify({ dependencies: { expo: "55", "expo-router": "6" } }));
    expect(hasRouter(project)).toBe(true);
    const s = await startRunServer({ dir, platform: "ios", name: "Shop", render: renderFrame, projectDir: project });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    const shell = await (await fetch(base + "/app/")).text();
    expect(shell).toContain("history.replaceState");
    expect(shell.indexOf("history.replaceState")).toBeLessThan(shell.indexOf("<title>"));
    expect(await (await fetch(base + "/app/feed/1")).text()).toContain("the app");
    const fromFrame = (path: string) => fetch(base + path, { redirect: "manual", headers: { "sec-fetch-dest": "iframe" } });
    const deep = await fromFrame("/feed/1?tab=new");
    expect(deep.status).toBe(302); expect(deep.headers.get("location")).toBe("/app/feed/1?tab=new");
    const home = await fromFrame("/");
    expect(home.status).toBe(302); expect(home.headers.get("location")).toBe("/app/");
    expect((await fromFrame("/app/feed/1")).status).toBe(200);
    expect(await (await fetch(base + "/")).text()).toContain("dynamic-island");
  });
  it("a build made with a base path gets its files under that path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    mkdirSync(join(dir, "_expo", "static", "js", "web"), { recursive: true });
    writeFileSync(join(dir, "_expo", "static", "js", "web", "app.js"), "bundle");
    writeFileSync(join(dir, "index.html"), '<html><head></head><body><script src="/static/_expo/static/js/web/app.js" defer></script></body></html>');
    expect(buildBase(dir)).toBe("/static");
    const s = await startRunServer({ dir, platform: "ios", name: "Social", render: renderFrame });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect(await (await fetch(base + "/static/_expo/static/js/web/app.js")).text()).toBe("bundle");
    expect((await fetch(base + "/other/_expo/static/js/web/app.js")).status).toBe(404);
    expect((await fetch(base + "/static/..%2f..%2fetc/passwd")).status).toBeGreaterThanOrEqual(403);
    expect(buildBase(mkdtempSync(join(tmpdir(), "run-empty-")))).toBe("");
  });
  it("an app without a router is served as before", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "<html><head><title>x</title></head><body>the app</body></html>");
    const project = mkdtempSync(join(tmpdir(), "run-proj-"));
    writeFileSync(join(project, "package.json"), JSON.stringify({ dependencies: { expo: "55" } }));
    expect(hasRouter(project)).toBe(false); expect(hasRouter(undefined)).toBe(false); expect(hasRouter(join(project, "missing"))).toBe(false);
    const s = await startRunServer({ dir, platform: "android", name: "Shop", render: renderFrame, projectDir: project });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect(await (await fetch(base + "/app/")).text()).not.toContain("history.replaceState");
    const framePage = await fetch(base + "/", { redirect: "manual", headers: { "sec-fetch-dest": "iframe" } });
    expect(framePage.status).toBe(200);
  });
  it("answers 400 to a malformed escape and keeps serving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "<p>the app</p>");
    const s = await startRunServer({ dir, platform: "android", name: "Tide", render: renderFrame });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect((await fetch(base + "/%E0%A4%A")).status).toBe(400);
    expect((await fetch(base + "/app/")).status).toBe(200);
  });
  it("falls back to index.html for client-side routes under /app/ but not for missing files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "<p>the app</p>");
    const s = await startRunServer({ dir, platform: "android", name: "Tide", render: renderFrame });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect(await (await fetch(base + "/app/settings")).text()).toBe("<p>the app</p>");
    expect((await fetch(base + "/app/missing.js")).status).toBe(404);
    expect((await fetch(base + "/nope")).status).toBe(404);
  });
  it("redirects /app to /app/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "x");
    const s = await startRunServer({ dir, platform: "android", name: "Tide", render: renderFrame });
    close = s.close;
    const r = await fetch(`http://127.0.0.1:${s.port}/app`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/app/");
  });
});

describe("--lan", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  const app = () => { const dir = mkdtempSync(join(tmpdir(), "run-")); writeFileSync(join(dir, "index.html"), "<p>the app</p>"); return dir; };
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  it("binds to localhost only without --lan", async () => {
    const s = await startRunServer({ dir: app(), platform: "ios", name: "Tide", render: renderFrame });
    close = s.close;
    expect((s.server.address() as { address: string }).address).toBe("127.0.0.1");
    expect(s.lanToken).toBeUndefined();
  });
  it("binds to all interfaces and answers 403 without the token, 200 with it", async () => {
    const s = await startRunServer({ dir: app(), platform: "ios", name: "Tide", render: renderFrame, lan: { host: "192.168.1.20" } });
    close = s.close;
    expect((s.server.address() as { address: string }).address).toBe("0.0.0.0");
    const base = `http://127.0.0.1:${s.port}`;
    expect((await fetch(base + "/")).status).toBe(403);
    expect((await fetch(base + "/app/")).status).toBe(403);
    expect((await fetch(base + "/?t=wrong")).status).toBe(403);
    const ok = await fetch(`${base}/?t=${s.lanToken}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("dynamic-island");
    // the page's own requests carry the cookie the first request set
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect((await fetch(base + "/app/", { headers: { cookie } })).status).toBe(200);
    // the LAN address as Host is accepted; any other Host is not
    const r = await new Promise<number>((res) => { const q = http.request({ port: s.port, host: "127.0.0.1", path: `/?t=${s.lanToken}`, headers: { host: `192.168.1.20:${s.port}` } }, (m) => { m.resume(); res(m.statusCode ?? 0); }); q.end(); });
    expect(r).toBe(200);
    const bad = await new Promise<number>((res) => { const q = http.request({ port: s.port, host: "127.0.0.1", path: `/?t=${s.lanToken}`, headers: { host: "evil.example" } }, (m) => { m.resume(); res(m.statusCode ?? 0); }); q.end(); });
    expect(bad).toBe(403);
  });
  it("skips the phone frame for a mobile user agent and keeps it on desktop", async () => {
    const s = await startRunServer({ dir: app(), platform: "ios", name: "Tide", render: renderFrame, lan: { host: "192.168.1.20" } });
    close = s.close;
    const url = `http://127.0.0.1:${s.port}/?t=${s.lanToken}`;
    const phone = await (await fetch(url, { headers: { "user-agent": IPHONE } })).text();
    expect(phone).toContain('data-part="bare-app"');
    expect(phone).not.toContain("dynamic-island");
    expect(await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120" } })).text()).toContain("dynamic-island");
  });
  it("picks a private LAN address", () => {
    const nic = (address: string, internal = false) => [{ address, family: "IPv4", internal }] as never;
    expect(lanAddress({ lo: nic("127.0.0.1", true), a: nic("203.0.113.5"), b: nic("192.168.1.20") })).toBe("192.168.1.20");
    expect(lanAddress({ lo: nic("127.0.0.1", true) })).toBeUndefined();
  });
});

describe("build failure", () => {
  it("names the module", () => {
    expect(describeWebBuildFailure("Error: Unable to resolve module react-native-maps from /app/src/Map.tsx: x")).toContain("react-native-maps");
  });
  it("names a file", () => {
    expect(describeWebBuildFailure("SyntaxError: bad\n  at src/Home.tsx")).toContain("src/Home.tsx");
  });
});

describe("buildWeb", () => {
  const node = (code: string) => `node -e ${JSON.stringify(code)} --`;
  it("names the module when the failure is printed to stdout only", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-b-"));
    const cmd = node("console.log('Unable to resolve module react-native-maps from src/Map.tsx');process.exit(1)");
    await expect(buildWeb(root, cmd)).rejects.toThrow(/react-native-maps/);
  });
  it("builds into sim-dist on success", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-b-"));
    const cmd = node("const d=process.argv[1];require('fs').mkdirSync(d,{recursive:true});require('fs').writeFileSync(d+'/index.html','ok')");
    await buildWeb(root, cmd);
    expect(readFileSync(join(root, "sim-dist", "index.html"), "utf8")).toBe("ok");
  });
});

describe("run()", () => {
  it("--native prints that it is not the simulated device; bad args return 2; missing config returns 1", async () => {
    const err: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
    const cwd = process.cwd(); const dir = mkdtempSync(join(tmpdir(), "run-c-"));
    try {
      expect(await run([])).toBe(2);
      process.chdir(dir);
      expect(await run(["android"])).toBe(1);
      expect(err.length).toBeGreaterThan(1);
    } finally { process.chdir(cwd); spy.mockRestore(); }
  });
  it("--native says so", async () => {
    const err: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
    process.env.RUN_TEST_FAKE_NATIVE = "1";
    try { expect(await run(["ios", "--native"])).toBe(0); } finally { spy.mockRestore(); delete process.env.RUN_TEST_FAKE_NATIVE; }
    expect(err.join("\n")).toContain("not the simulated device");
  });
});

describe("no playwright (source grep guard)", () => {
  it("run.ts and what it imports never reference playwright", () => {
    for (const f of ["run.ts", "config.ts"]) expect(readFileSync(join(__dirname, "../src", f), "utf8")).not.toMatch(/playwright/i);
    const sim = readFileSync(join(__dirname, "../src/sim.ts"), "utf8");
    // sim.ts may import our own ensure step ("./ensure-playwright.js"), never the playwright package.
    expect(sim.replace(/from "\.\/ensure-playwright\.js"/g, "")).not.toMatch(/import[^\n]*playwright|require\(["']playwright/);
  });
});

describe("server dark page", () => {
  it("serves the dark frame at /?dark=1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "x");
    const s = await startRunServer({ dir, platform: "android", name: "Tide", render: renderFrame });
    try { expect(await (await fetch(`http://127.0.0.1:${s.port}/?dark=1`)).text()).toContain("--sf-fg:#fff"); } finally { await s.close(); }
  });
});
