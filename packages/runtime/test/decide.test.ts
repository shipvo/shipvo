import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideRelease, semverLess, type PointerFields, type ShellFacts } from "../src/decide";

const shell: ShellFacts = { platform: "android", appId: "tide", shellMajor: 1, shellVersion: "1.0.2", knownRelease: 3, hermesBytecodeVersion: 96 };
const ptr: PointerFields = { app_id: "tide", shell_major: 1, release: 4, min_shell_version: "1.0.0", hermes_bytecode_version: 96 };

describe("decideRelease", () => {
  it("takes a newer matching release", () => { expect(decideRelease(ptr, shell)).toEqual({ take: true }); });
  it("android rejects an ios pointer and ios rejects an android one", () => {
    expect(decideRelease({ ...ptr, platform: "ios" }, shell)).toMatchObject({ take: false, reason: "wrong_platform" });
    expect(decideRelease(ptr, { ...shell, platform: "ios" })).toMatchObject({ take: false, reason: "wrong_platform" });
    expect(decideRelease({ ...ptr, platform: "ios" }, { ...shell, platform: "ios" })).toEqual({ take: true });
  });
  it("rejects another app or shell major", () => {
    expect(decideRelease({ ...ptr, app_id: "x" }, shell)).toMatchObject({ reason: "other_app_or_shell" });
    expect(decideRelease({ ...ptr, shell_major: 2 }, shell)).toMatchObject({ reason: "other_app_or_shell" });
  });
  it("skips a release that is not newer", () => {
    expect(decideRelease({ ...ptr, release: 3 }, shell)).toMatchObject({ take: false, reason: "not_newer" });
    expect(decideRelease({ ...ptr, release: 2 }, shell)).toMatchObject({ reason: "not_newer" });
  });
  it("rejects when the shell is older than min_shell_version", () => {
    expect(decideRelease({ ...ptr, min_shell_version: "1.1.0" }, shell)).toMatchObject({ reason: "shell_too_old" });
    expect(decideRelease({ ...ptr, min_shell_version: "1.0.2" }, shell)).toEqual({ take: true });
  });
  it("treats a missing min_shell_version as 0.0.0", () => {
    expect(decideRelease({ ...ptr, min_shell_version: undefined }, shell)).toEqual({ take: true });
  });
  it("blocks a Hermes bytecode mismatch", () => {
    expect(decideRelease({ ...ptr, hermes_bytecode_version: 98 }, shell))
      .toEqual({ take: false, reason: "hermes_bytecode_mismatch", release: 4, block: true, releaseVersion: 98, shellVersion: 96 });
  });
  it("takes the release when either bytecode version is unknown or invalid", () => {
    expect(decideRelease({ ...ptr, hermes_bytecode_version: undefined }, shell)).toEqual({ take: true });
    expect(decideRelease({ ...ptr, hermes_bytecode_version: 96.5 }, shell)).toEqual({ take: true });
    expect(decideRelease({ ...ptr, hermes_bytecode_version: "98" }, shell)).toEqual({ take: true });
    expect(decideRelease({ ...ptr, hermes_bytecode_version: 0 }, shell)).toEqual({ take: true });
    expect(decideRelease({ ...ptr, hermes_bytecode_version: 98 }, { ...shell, hermesBytecodeVersion: null })).toEqual({ take: true });
  });
  it("checks in a fixed order: platform, app, newer, shell version, bytecode", () => {
    const bad = { ...ptr, platform: "ios" as const, app_id: "x", release: 1, min_shell_version: "9.0.0", hermes_bytecode_version: 1 };
    expect(decideRelease(bad, shell)).toMatchObject({ reason: "wrong_platform" });
    expect(decideRelease({ ...bad, platform: undefined }, shell)).toMatchObject({ reason: "other_app_or_shell" });
    expect(decideRelease({ ...bad, platform: undefined, app_id: "tide" }, shell)).toMatchObject({ reason: "not_newer" });
    expect(decideRelease({ ...bad, platform: undefined, app_id: "tide", release: 9 }, shell)).toMatchObject({ reason: "shell_too_old" });
  });
});

describe("semverLess", () => {
  it("compares major, minor and patch", () => {
    expect(semverLess("1.0.2", "1.0.10")).toBe(true);
    expect(semverLess("1.2.0", "1.1.9")).toBe(false);
    expect(semverLess("1.0.0", "1.0.0")).toBe(false);
    expect(semverLess("1.0", "1.0.1")).toBe(true);
    expect(semverLess("1.0.0-beta", "1.0.0")).toBe(false);
  });
});

describe("decide.ts stays framework-free", () => {
  it("imports nothing", () => {
    const code = readFileSync(new URL("../src/decide.ts", import.meta.url), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/\bimport\b|require\(|react-native|expo-/);
  });
});

describe("@shipvo/runtime/decide subpath", () => {
  it("is exported and resolves to a module that works without the main entry", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.exports["./decide"]).toEqual({ types: "./src/decide.ts", default: "./src/decide.ts" });
    const mod = await import(/* @vite-ignore */ new URL("../" + pkg.exports["./decide"].default, import.meta.url).href);
    expect(mod.decideRelease(ptr, shell)).toEqual({ take: true });
  });
});
