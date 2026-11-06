import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawn = vi.fn();
const spawnSync = vi.fn();
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawn, spawnSync }));

function fakeChild(_c: string, args: string[]) {
  const out = args[args.indexOf("--output-dir") + 1];
  if (out) mkdirSync(out, { recursive: true });
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  setImmediate(() => c.emit("close", 0, null) || c.emit("exit", 0));
  return c;
}
const real = process.platform;
const setPlatform = (v: string) => Object.defineProperty(process, "platform", { value: v });

beforeEach(() => { spawn.mockReset().mockImplementation(fakeChild); spawnSync.mockReset().mockReturnValue({ status: 0 }); setPlatform("win32"); });
afterEach(() => setPlatform(real));

describe("win32 call shape", () => {
  it("sim: rebuildInto runs npx.cmd with a shell", async () => {
    const { rebuildInto } = await import("../src/sim");
    const root = mkdtempSync(join(tmpdir(), "sv-"));
    await rebuildInto({ root });
    const [cmd, args, o] = spawn.mock.calls[0];
    expect(cmd).toBe("npx.cmd");
    expect(args.slice(0, 2)).toEqual(["expo", "export"]);
    expect(o.shell).toBe(true);
    expect(o.env.PN_SIM).toBe("1");
  });

  it("run: --native runs npx.cmd with a shell", async () => {
    const { run } = await import("../src/run");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await run(["android", "--native"])).toBe(0); } finally { spy.mockRestore(); }
    expect(spawnSync).toHaveBeenCalledWith("npx.cmd", ["expo", "run:android"], { stdio: "inherit", shell: true });
  });

  it("preview: build runs npx.cmd with a shell", async () => {
    const { build } = await import("../src/preview");
    const root = mkdtempSync(join(tmpdir(), "sv-"));
    await build(root, join(root, "out"));
    const [cmd, args, o] = spawn.mock.calls[0];
    expect(cmd).toBe("npx.cmd");
    expect(args.slice(0, 2)).toEqual(["expo", "export"]);
    expect(o.shell).toBe(true);
    expect(o.env.PN_SIM).toBe("1");
  });
});
