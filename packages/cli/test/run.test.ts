import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunArgs, nativeCommand, runFramePage, startRunServer, describeWebBuildFailure } from "../src/run";

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
});

describe("build failure", () => {
  it("names the module", () => {
    expect(describeWebBuildFailure("Error: Unable to resolve module react-native-maps from /app/src/Map.tsx: x")).toContain("react-native-maps");
  });
  it("names a file", () => {
    expect(describeWebBuildFailure("SyntaxError: bad\n  at src/Home.tsx")).toContain("src/Home.tsx");
  });
});

describe("no playwright", () => {
  it("run.ts and what it imports never reference playwright", () => {
    for (const f of ["run.ts", "config.ts"]) expect(readFileSync(join(__dirname, "../src", f), "utf8")).not.toMatch(/playwright/i);
    const sim = readFileSync(join(__dirname, "../src/sim.ts"), "utf8");
    expect(sim).not.toMatch(/import[^\n]*playwright|require\(["']playwright/);
  });
});
