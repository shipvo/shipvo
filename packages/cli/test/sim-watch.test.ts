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

  it("several quick writes cause one rebuild; ignored folders cause none", async () => {
    const build = vi.fn(async () => {});
    const { dir, log, stop } = await setup(build);
    for (let i = 0; i < 5; i++) { writeFileSync(join(dir, "src", "a.ts"), `v${i}`); await wait(20); }
    await wait(500);
    expect(build).toHaveBeenCalledTimes(1);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^rebuilt in \d+\.\d s$/);
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
    expect(log).toEqual(["build failed, still serving the last good build: Unexpected token"]);
    writeFileSync(join(dir, "src", "a.ts"), "good");
    await wait(500);
    expect(log[1]).toMatch(/^rebuilt in/);
    stop();
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
