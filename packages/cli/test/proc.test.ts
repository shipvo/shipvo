import { describe, it, expect } from "vitest";
import { shellForm, spawnBinSync, execBinSync, pythonNames } from "../src/proc.js";
import { readFileSync } from "node:fs";
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

describe("shellForm quoting", () => {
  it("quotes % so cmd.exe does not expand %VAR%", () => {
    expect(shellForm("npx", ["%PATH%"], "win32").command).toBe('npx "%PATH%"');
  });
});

describe("spawn wrappers", () => {
  it("spawnBinSync runs a real process and passes args and env", () => {
    const r = spawnBinSync(process.execPath, ["-e", "process.stdout.write(process.argv[1] + process.env.PN_SIM)", "a b"], { encoding: "utf8", env: { ...process.env, PN_SIM: "1" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("a b1");
  });
  it("execBinSync throws on a non-zero exit", () => {
    expect(() => execBinSync(process.execPath, ["-e", "process.exit(3)"])).toThrow(/code 3/);
  });
});

describe("pythonNames", () => {
  it("tries python and py first on Windows", () => {
    expect(pythonNames("win32")).toEqual(["python", "py", "python3"]);
    expect(pythonNames("linux")[0]).toBe("python3");
  });
});

describe("no shell-only syntax in exec calls", () => {
  it("has no VAR=1 command prefixes or single-quoted python in publish.ts and explore.ts", () => {
    for (const f of ["../src/publish.ts", "../src/explore.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/exec\w*\(\s*["`]PN_SIM=/);
      expect(src).not.toMatch(/python3 -c/);
    }
  });
});

describe("ignoredPath", () => {
  it("ignores Windows-style separators", () => {
    expect(ignoredPath("node_modules\\react\\index.js")).toBe(true);
    expect(ignoredPath("src\\App.tsx")).toBe(false);
  });
});
