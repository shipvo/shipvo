import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunArgs, nativeCommand, runFramePage, startRunServer, describeWebBuildFailure, buildWeb } from "../src/run";

describe("parseRunArgs", () => {
  it("parses platform and flags", () => {
    expect(parseRunArgs(["android"])).toEqual({ platform: "android", open: true, port: undefined, native: false });
    expect(parseRunArgs(["ios", "--no-open", "--port", "5000", "--native"])).toEqual({ platform: "ios", open: false, port: 5000, native: true });
    expect(parseRunArgs(["--no-open", "ios"]).platform).toBe("ios");
  });
  it("rejects bad input", () => {
    expect(() => parseRunArgs([])).toThrow(/android or shipvo run ios/);
    expect(() => parseRunArgs(["windows"])).toThrow(/Unknown argument/);
    expect(() => parseRunArgs(["ios", "--port", "abc"])).toThrow(/--port/);
    expect(() => parseRunArgs(["ios", "--port"])).toThrow(/--port/);
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
    const h = runFramePage("android", "Tide");
    expect(h).toContain("412px"); expect(h).toContain("915px");
    expect(h).toContain('data-part="punch-hole"'); expect(h).toContain('data-part="gesture-bar"');
    expect(h).not.toContain("dynamic-island"); expect(h).toContain("Simulated"); expect(h).toContain("While using the app");
  });
  it("has the iOS frame", () => {
    const h = runFramePage("ios", "Tide");
    expect(h).toContain("393px"); expect(h).toContain("852px");
    expect(h).toContain('data-part="dynamic-island"'); expect(h).toContain('data-part="home-indicator"');
    expect(h).not.toContain("punch-hole"); expect(h).toContain("Allow While Using App");
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
    const s = await startRunServer({ dir, platform: "ios", name: "Tide" });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect(await (await fetch(base + "/")).text()).toContain("dynamic-island");
    expect(await (await fetch(base + "/app/")).text()).toBe("<p>the app</p>");
    const js = await fetch(base + "/_expo/a.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await fetch(base + "/nope")).status).toBe(404);
    expect((await fetch(base + "/..%2f..%2fetc/passwd")).status).toBeGreaterThanOrEqual(403);
  });
  it("answers 400 to a malformed escape and keeps serving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "<p>the app</p>");
    const s = await startRunServer({ dir, platform: "android", name: "Tide" });
    close = s.close;
    const base = `http://127.0.0.1:${s.port}`;
    expect((await fetch(base + "/%E0%A4%A")).status).toBe(400);
    expect((await fetch(base + "/app/")).status).toBe(200);
  });
  it("redirects /app to /app/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    writeFileSync(join(dir, "index.html"), "x");
    const s = await startRunServer({ dir, platform: "android", name: "Tide" });
    close = s.close;
    const r = await fetch(`http://127.0.0.1:${s.port}/app`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/app/");
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

describe("no playwright", () => {
  it("run.ts and what it imports never reference playwright", () => {
    for (const f of ["run.ts", "config.ts"]) expect(readFileSync(join(__dirname, "../src", f), "utf8")).not.toMatch(/playwright/i);
    const sim = readFileSync(join(__dirname, "../src/sim.ts"), "utf8");
    expect(sim).not.toMatch(/import[^\n]*playwright|require\(["']playwright/);
  });
});
