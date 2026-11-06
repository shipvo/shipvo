import { describe, expect, it } from "vitest";
import { spawnBin } from "./spawn-bin.js";

describe("spawnBin", () => {
  it("does not change anything on linux", () => {
    expect(spawnBin("npx", ["expo", "export", "--output-dir", "/tmp/a b"], "linux")).toEqual({ command: "npx", args: ["expo", "export", "--output-dir", "/tmp/a b"], shell: false });
  });
  it("uses the .cmd shim and a shell on win32", () => {
    expect(spawnBin("npx", ["expo", "run:android"], "win32")).toEqual({ command: "npx.cmd", args: ["expo", "run:android"], shell: true });
    expect(spawnBin("pnpm", ["install"], "win32").command).toBe("pnpm.cmd");
  });
  it("quotes args with spaces on win32", () => {
    expect(spawnBin("npx", ["expo", "--output-dir", "C:\\My Apps\\out"], "win32").args).toEqual(["expo", "--output-dir", '"C:\\My Apps\\out"']);
  });
  it("handles node_modules/.bin paths with spaces on win32", () => {
    const r = spawnBin("C:\\My App\\node_modules\\.bin\\tsc", [], "win32");
    expect(r).toEqual({ command: '"C:\\My App\\node_modules\\.bin\\tsc.cmd"', args: [], shell: true });
  });
  it("leaves other programs alone on win32", () => {
    expect(spawnBin("node", ["a b"], "win32")).toEqual({ command: "node", args: ["a b"], shell: false });
  });
});
