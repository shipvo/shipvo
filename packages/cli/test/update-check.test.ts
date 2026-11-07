import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeReleaseAgeExclude, writeReleaseAgeExclude, compareVersions, updateCommand, newerCliHasCommand } from "../src/update-check";
import { runDoctorChecks } from "../src/doctor";
import { COMMANDS } from "../src/help";

const registry = (version: string, commands?: string[]) =>
  vi.fn(async () => new Response(JSON.stringify({ version, shipvoCommands: commands }))) as unknown as typeof fetch;
const dir = () => mkdtempSync(join(tmpdir(), "uc-"));

describe("pnpm-workspace.yaml", () => {
  it("creates the file with the three names", () => {
    const d = dir(); writeReleaseAgeExclude(d);
    const t = readFileSync(join(d, "pnpm-workspace.yaml"), "utf8");
    expect(t).toBe('minimumReleaseAgeExclude:\n  - "@shipvo/*"\n  - "shipvo"\n  - "create-shipvo"\n');
  });
  it("merges into an existing file and keeps everything", () => {
    const d = dir();
    writeFileSync(join(d, "pnpm-workspace.yaml"), "packages:\n  - apps/*\nminimumReleaseAgeExclude:\n  - left-pad\n  - '@shipvo/*'\nonlyBuiltDependencies:\n  - esbuild\n");
    writeReleaseAgeExclude(d);
    const t = readFileSync(join(d, "pnpm-workspace.yaml"), "utf8");
    expect(t).toBe('packages:\n  - apps/*\nminimumReleaseAgeExclude:\n  - left-pad\n  - \'@shipvo/*\'\n  - "shipvo"\n  - "create-shipvo"\nonlyBuiltDependencies:\n  - esbuild\n');
    writeReleaseAgeExclude(d);
    expect(readFileSync(join(d, "pnpm-workspace.yaml"), "utf8")).toBe(t);
  });
  it("appends the key to a file without it and merges inline lists", () => {
    expect(mergeReleaseAgeExclude("packages:\n  - a\n")).toContain("packages:\n  - a\nminimumReleaseAgeExclude:\n");
    expect(mergeReleaseAgeExclude("minimumReleaseAgeExclude: [foo]\n")).toBe('minimumReleaseAgeExclude: [foo, "@shipvo/*", "shipvo", "create-shipvo"]\n');
  });
});

describe("version check", () => {
  it("compares versions", () => {
    expect(compareVersions("0.1.6", "0.1.5")).toBe(1);
    expect(compareVersions("0.1.5", "0.1.5")).toBe(0);
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBe(-1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
  });
  it("doctor warns when npm has a newer CLI and prints the pm command", async () => {
    const cwd = dir(); writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    const r = await runDoctorChecks({ cwd, cliVersion: () => "0.1.5", fetchFn: registry("0.1.6") });
    const c = r.find((x) => x.name === "@shipvo/cli is up to date")!;
    expect(c.ok).toBe(false);
    expect(c.fix).toBe("@shipvo/cli 0.1.6 is out; you have 0.1.5. Update with: pnpm add -D @shipvo/cli@latest");
  });
  it("doctor passes when current, and skips when offline or unreachable", async () => {
    const cwd = dir();
    const same = await runDoctorChecks({ cwd, cliVersion: () => "0.1.6", fetchFn: registry("0.1.6") });
    expect(same.find((x) => x.name === "@shipvo/cli is up to date")!.ok).toBe(true);
    const off = await runDoctorChecks({ cwd, offline: true, cliVersion: () => "0.1.5", fetchFn: registry("0.1.6") });
    expect(off.some((x) => x.name === "@shipvo/cli is up to date")).toBe(false);
    const down = await runDoctorChecks({ cwd, cliVersion: () => "0.1.5", fetchFn: (async () => { throw new Error("x"); }) as typeof fetch });
    expect(down.some((x) => x.name === "@shipvo/cli is up to date")).toBe(false);
  });
  it("names the version that has an unknown command", async () => {
    const cwd = dir();
    expect(await newerCliHasCommand("lumi", cwd, "0.1.5", registry("0.1.6", ["init", "lumi"]))).toBe("'lumi' is in @shipvo/cli 0.1.6; you have 0.1.5. Update with: " + updateCommand("npm"));
    expect(await newerCliHasCommand("nope", cwd, "0.1.5", registry("0.1.6", ["init"]))).toBeNull();
    expect(await newerCliHasCommand("lumi", cwd, "0.1.6", registry("0.1.6", ["lumi"]))).toBeNull();
  });
  it("package.json lists the same commands as the CLI", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.shipvoCommands).toEqual([...COMMANDS]);
  });
});
