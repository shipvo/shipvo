import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("watchAndRebuild", () => {
  const setup = async (build: () => Promise<void>) => {
    const { watchAndRebuild } = await import("../src/sim");
    const dir = mkdtempSync(join(tmpdir(), "watch-"));
    mkdirSync(join(dir, "src")); mkdirSync(join(dir, "node_modules"));
    const log: string[] = [];
    const stop = watchAndRebuild({ dir, build, debounceMs: 100, log: (l) => log.push(l) });
    await new Promise((r) => setTimeout(r, 100));
    return { dir, log, stop };
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("a save during a build announces the queued rebuild again", async () => {
    const { watchAndRebuild } = await import("../src/sim");
    const dir = mkdtempSync(join(tmpdir(), "watch-"));
    mkdirSync(join(dir, "src"));
    const log: string[] = []; let starts = 0;
    const build = vi.fn(() => new Promise<void>((r) => setTimeout(r, 400)));
    const stop = watchAndRebuild({ dir, build, debounceMs: 50, log: (l) => log.push(l), onStart: () => { starts++; } });
    await wait(100);
    writeFileSync(join(dir, "src", "a.ts"), "1");
    await wait(200); // build 1 is running
    writeFileSync(join(dir, "src", "a.ts"), "2");
    await wait(1200);
    stop();
    expect(build).toHaveBeenCalledTimes(2);
    expect(log.filter((l) => l === "Rebuilding...")).toHaveLength(2);
    expect(starts).toBe(3); // save 1, save 2, and again when the queued build starts after build 1 ended
  });

  it("several quick writes cause one rebuild; ignored folders cause none", async () => {
    const build = vi.fn(async () => {});
    const { dir, log, stop } = await setup(build);
    for (let i = 0; i < 5; i++) { writeFileSync(join(dir, "src", "a.ts"), `v${i}`); await wait(20); }
    await wait(500);
    expect(build).toHaveBeenCalledTimes(1);
    expect(log).toHaveLength(2);
    expect(log[0]).toBe("Rebuilding...");
    expect(log[1]).toMatch(/^rebuilt in \d+\.\d s$/);
    writeFileSync(join(dir, "node_modules", "x.js"), "x");
    await wait(400);
    expect(build).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a failing build prints the error and the next edit builds again", async () => {
    const build = vi.fn().mockRejectedValueOnce(new Error("Unexpected token")).mockResolvedValue(undefined);
    const { dir, log, stop } = await setup(build);
    writeFileSync(join(dir, "src", "a.ts"), "bad");
    await wait(500);
    expect(log).toEqual(["Rebuilding...", "build failed, still serving the last good build: Unexpected token (run with --verbose for details)"]);
    writeFileSync(join(dir, "src", "a.ts"), "good");
    await wait(500);
    expect(log.at(-1)).toMatch(/^rebuilt in/);
    expect(log.filter((l) => l === "Rebuilding...")).toHaveLength(2);
    stop();
  });
});

describe("watchAndRebuild verbose", () => {
  it("passes verbose through, so the logged line has the full multi-line message", async () => {
    const { watchAndRebuild } = await import("../src/sim");
    const dir = mkdtempSync(join(tmpdir(), "watch-v-"));
    mkdirSync(join(dir, "src"));
    const log: string[] = [];
    const build = async () => { throw new Error("Unexpected token\n    at transformJSON (x.js:1:1)"); };
    const stop = watchAndRebuild({ dir, build, debounceMs: 100, log: (l) => log.push(l), verbose: true });
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(dir, "src", "a.ts"), "x");
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(log).toEqual(["Rebuilding...", "build failed, still serving the last good build: Unexpected token\n    at transformJSON (x.js:1:1)"]);
  });
});

describe("friendlyBuildError", () => {
  it("describes a non-comma JSON error", async () => {
    const { friendlyBuildError } = await import("../src/sim");
    const out = friendlyBuildError("SyntaxError: Unexpected token } in file a/b.json at 3:7\n  at x");
    expect(out).toContain("a/b.json has a mistake at line 3, column 7: a character is missing, extra or in the wrong place.");
  });
  it("does not blame JSON for a resolve error that only names a .json file", async () => {
    const { friendlyBuildError } = await import("../src/sim");
    const out = friendlyBuildError("Unable to resolve module ./x in file a.json at 1:2");
    expect(out).toContain("--verbose");
    expect(out).not.toContain("mistake");
  });
  const metro = "SyntaxError: Error: Unexpected token string «name», expected punc «,» in file src/data/products.json at 23:4\n    at async transformJSON (x.js:1:1)";
  it("names the file and line for broken JSON and hides the stack", async () => {
    const { friendlyBuildError } = await import("../src/sim");
    const out = friendlyBuildError(metro);
    expect(out).toBe("Your file src/data/products.json has a mistake at line 23, column 4: check for a missing or extra comma. The page still shows your last good version.");
    expect(out).not.toContain("transformJSON");
  });
  it("keeps the full message with --verbose", async () => {
    const { friendlyBuildError } = await import("../src/sim");
    expect(friendlyBuildError(metro, true)).toContain("transformJSON");
  });
});

describe("ignoredPath", () => {
  it("ignores build output folders and keeps source files", async () => {
    const { ignoredPath } = await import("../src/sim");
    for (const p of ["node_modules/x.js", "sim-dist/index.html", ".shipvo/sim-next/a", ".expo/x", "dist/a.js", "dist-ota/a", "web-build/a", "ios/Pods/a", "android/app/b", "src/.expo/x"]) expect(ignoredPath(p)).toBe(true);
    for (const p of ["src/a.ts", "App.tsx", "app.json", "src/distance.ts"]) expect(ignoredPath(p)).toBe(false);
  });
});

describe("rebuildInto", () => {
  const project = () => {
    const root = mkdtempSync(join(tmpdir(), "rebuild-"));
    mkdirSync(join(root, "sim-dist"));
    writeFileSync(join(root, "sim-dist", "index.html"), "old");
    return root;
  };
  const node = (code: string) => `node -e ${JSON.stringify(code)}`;
  const okCmd = node("const d=process.argv[1];require('fs').mkdirSync(d,{recursive:true});require('fs').writeFileSync(d+'/index.html','new')");

  it("on success sim-dist holds the new files", async () => {
    const { rebuildInto } = await import("../src/sim");
    const root = project();
    await rebuildInto({ root, command: okCmd + " --" });
    expect(readFileSync(join(root, "sim-dist", "index.html"), "utf8")).toBe("new");
    expect(existsSync(join(root, ".shipvo", "sim-next"))).toBe(false);
    expect(existsSync(join(root, ".shipvo", "sim-prev"))).toBe(false);
  });

  it("on build failure sim-dist is unchanged and sim-next is cleaned up", async () => {
    const { rebuildInto } = await import("../src/sim");
    const root = project();
    const cmd = node("const d=process.argv[1];require('fs').mkdirSync(d,{recursive:true});console.error('Unexpected token');process.exit(1)") + " --";
    await expect(rebuildInto({ root, command: cmd })).rejects.toThrow("Unexpected token");
    expect(readFileSync(join(root, "sim-dist", "index.html"), "utf8")).toBe("old");
    expect(existsSync(join(root, ".shipvo", "sim-next"))).toBe(false);
  });

  it("a failed swap puts the old build back and rejects", async () => {
    const { rebuildInto } = await import("../src/sim");
    const root = project();
    // The build exits 0 but writes no output, so sim-next is missing at swap time.
    await expect(rebuildInto({ root, command: node("0") + " --" })).rejects.toThrow();
    expect(readFileSync(join(root, "sim-dist", "index.html"), "utf8")).toBe("old");
    expect(existsSync(join(root, ".shipvo", "sim-prev"))).toBe(false);
  });

  it("does not fail on build output larger than 1 MB", async () => {
    const { rebuildInto } = await import("../src/sim");
    const root = project();
    const cmd = node("const d=process.argv[1];require('fs').mkdirSync(d,{recursive:true});require('fs').writeFileSync(d+'/index.html','big');console.error('x'.repeat(3e6))") + " --";
    await rebuildInto({ root, command: cmd });
    expect(readFileSync(join(root, "sim-dist", "index.html"), "utf8")).toBe("big");
  });
});

describe("expoExportArgs", () => {
  it("clears the Metro cache on the first build and keeps it for warm rebuilds", async () => {
    const { expoExportArgs } = await import("../src/sim");
    expect(expoExportArgs("out")).toContain("--clear");
    expect(expoExportArgs("out", true)).not.toContain("--clear");
    expect(expoExportArgs("out", true).slice(-2)).toEqual(["--output-dir", "out"]);
  });
});

describe("shouldOpenWatch", () => {
  it("opens by default, not with --no-open or --json", async () => {
    const { shouldOpenWatch } = await import("../src/sim");
    expect(shouldOpenWatch({})).toBe(true);
    expect(shouldOpenWatch({ noOpen: true })).toBe(false);
    expect(shouldOpenWatch({ json: true })).toBe(false);
  });
});

describe("--no-open", () => {
  it("parses to \"true\" through args", async () => {
    const { args } = await import("../src/config");
    expect(args(["--no-open"])["no-open"]).toBe("true");
    expect(args(["--port", "4545"])["no-open"]).toBeUndefined();
  });
});
