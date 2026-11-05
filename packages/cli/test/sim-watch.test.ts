import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
