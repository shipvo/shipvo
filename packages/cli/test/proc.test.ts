import { describe, it, expect } from "vitest";
import { shellForm } from "../src/proc.js";
import { ignoredPath } from "../src/sim.js";

describe("shellForm", () => {
  it("leaves commands alone off Windows", () => {
    expect(shellForm("npx", ["expo", "export"], "linux")).toEqual({ command: "npx", args: ["expo", "export"], shell: false });
    expect(shellForm("npx", ["a b"], "darwin").shell).toBe(false);
  });
  it("runs shims through the shell on Windows and quotes paths with spaces", () => {
    const f = shellForm("npx", ["expo", "export", "--output-dir", "C:\\Users\\Jo Smith\\my app\\sim-dist"], "win32");
    expect(f.shell).toBe(true);
    expect(f.args).toEqual([]);
    expect(f.command).toBe('npx expo export --output-dir "C:\\Users\\Jo Smith\\my app\\sim-dist"');
  });
  it("does not use a shell for node itself", () => {
    expect(shellForm(process.execPath, ["x.js"], "win32").shell).toBe(false);
  });
  it("escapes double quotes", () => {
    expect(shellForm("npm", ['a"b'], "win32").command).toBe('npm "a""b"');
  });
});

describe("ignoredPath", () => {
  it("ignores Windows-style separators", () => {
    expect(ignoredPath("node_modules\\react\\index.js")).toBe(true);
    expect(ignoredPath("src\\App.tsx")).toBe(false);
  });
});
