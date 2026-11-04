import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { suggest } from "../src/help";

const root = resolve(__dirname, "..");
let out = "";
const run = (...args: string[]) => spawnSync(process.execPath, [join(out, "cli.js"), ...args], { encoding: "utf8" });

beforeAll(() => {
  out = mkdtempSync(join(root, "dist-test-"));
  const tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json"), "--outDir", out], { encoding: "utf8" });
  expect(r.status, r.stdout + r.stderr).toBe(0);
}, 60_000);

afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); });

describe("cli", () => {
  it("names an unknown command and suggests the closest one", () => {
    const r = run("publsh");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("shipvo: 'publsh' is not a command. Did you mean 'publish'?");
    expect(r.stderr).toContain("Run 'shipvo --help' to see all commands.");
    expect(r.stdout).toBe("");
  });

  it("does not suggest when nothing is close", () => {
    const r = run("zzzzzzzz");
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("Did you mean");
    expect(r.stdout).toBe("");
  });

  it("shows grouped help for --help and for no command", () => {
    for (const args of [["--help"], []]) {
      const r = run(...args);
      expect(r.status).toBe(0);
      for (const h of ["Start", "Ship", "Advanced"]) expect(r.stdout).toContain(`\n${h}\n`);
    }
  });
});

describe("suggest", () => {
  it("uses edit distance 2 or less", () => {
    expect(suggest("sing-json")).toBe("sign-json");
    expect(suggest("roll")).toBeUndefined();
  });
});
