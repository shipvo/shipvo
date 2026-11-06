import { describe, it, expect } from "vitest";
import { spawnBin } from "../src/spawn-bin";

describe("spawnBin", () => {
  it("adds .cmd and shell on win32", () => {
    expect(spawnBin("npx", ["expo", "start"], "win32")).toEqual({
      command: "npx.cmd",
      args: ["expo", "start"],
      shell: true,
    });
    expect(spawnBin("npm", [], "win32").command).toBe("npm.cmd");
    expect(spawnBin("pnpm", [], "win32").command).toBe("pnpm.cmd");
  });

  it("leaves other commands without .cmd on win32", () => {
    expect(spawnBin("adb", ["devices"], "win32")).toEqual({
      command: "adb",
      args: ["devices"],
      shell: true,
    });
  });

  it("quotes args with a space and a comma on win32", () => {
    const call = spawnBin("npx", ["--name", "My App", "a,b", "plain"], "win32");
    expect(call.args).toEqual(["--name", '"My App"', '"a,b"', "plain"]);
  });

  it("returns the call unchanged on linux", () => {
    expect(spawnBin("npx", ["My App", "a,b"], "linux")).toEqual({
      command: "npx",
      args: ["My App", "a,b"],
    });
  });

  it("defaults to the current platform", () => {
    const call = spawnBin("npx", ["x"]);
    expect(call.command).toBe(process.platform === "win32" ? "npx.cmd" : "npx");
  });
});
