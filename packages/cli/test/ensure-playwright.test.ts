import { describe, it, expect, vi } from "vitest";
import { ensurePlaywright } from "../src/ensure-playwright";

const setup = (files: string[], env: NodeJS.ProcessEnv = {}, resolves = false) => {
  const run = vi.fn();
  const log = vi.fn();
  const deps = { cwd: "/app", env, exists: (p: string) => files.some((f) => p === `/app/${f}`), run, log, resolves: () => resolves };
  return { run, log, deps };
};

describe("ensurePlaywright", () => {
  it.each([
    [["pnpm-lock.yaml"], "pnpm", ["add", "-D", "playwright"]],
    [["yarn.lock"], "yarn", ["add", "-D", "playwright"]],
    [["bun.lock"], "bun", ["add", "-d", "playwright"]],
    [["bun.lockb"], "bun", ["add", "-d", "playwright"]],
    [["package-lock.json"], "npm", ["install", "--save-dev", "playwright"]],
    [[], "npm", ["install", "--save-dev", "playwright"]],
  ])("lockfiles %j run %s", (files, cmd, args) => {
    const { run, log, deps } = setup(files);
    ensurePlaywright(deps);
    expect(run).toHaveBeenCalledWith(cmd, args, "/app");
    expect(log.mock.calls.join("\n")).toContain(`${cmd} ${args.join(" ")}`);
  });

  it("does nothing when playwright resolves", () => {
    const { run, log, deps } = setup(["pnpm-lock.yaml"], {}, true);
    ensurePlaywright(deps);
    expect(run).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("opt-out throws with the command and does not run", () => {
    const { run, deps } = setup(["yarn.lock"], { SHIPVO_NO_AUTO_INSTALL: "1" });
    expect(() => ensurePlaywright(deps)).toThrow("yarn add -D playwright");
    expect(run).not.toHaveBeenCalled();
  });

  it("surfaces the manager's error", () => {
    const { run, deps } = setup(["pnpm-lock.yaml"]);
    run.mockImplementation(() => { throw new Error("ERR_PNPM_OFFLINE no network"); });
    expect(() => ensurePlaywright(deps)).toThrow(/pnpm add -D playwright.*ERR_PNPM_OFFLINE no network/);
  });
});
