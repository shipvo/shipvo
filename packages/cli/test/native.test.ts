import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requiredNativeModules } from "../src/native";

let root: string;
const app = (deps: Record<string, string>) => writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: deps }));
const pkg = (name: string, files: string[] = [], dirs: string[] = []) => {
  const d = join(root, "node_modules", name);
  mkdirSync(d, { recursive: true });
  for (const f of files) writeFileSync(join(d, f), "");
  for (const x of dirs) mkdirSync(join(d, x));
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "native-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("requiredNativeModules", () => {
  it("returns undefined without a package.json or without native deps", () => {
    expect(requiredNativeModules(root)).toBeUndefined();
    app({ lodash: "^4.0.0" });
    pkg("lodash", ["index.js"]);
    expect(requiredNativeModules(root)).toBeUndefined();
  });

  it("detects android/, ios/, podspec and config-file packages, sorted by name", () => {
    app({ zeta: "1.0.0", a1: "~2.1.0", b1: "^3.0.0", c1: "4.x", d1: "^5.0.0" });
    pkg("zeta", [], ["android"]);
    pkg("a1", [], ["ios"]);
    pkg("b1", ["thing.podspec"]);
    pkg("c1", ["expo-module.config.json"]);
    pkg("d1", ["react-native.config.js"]);
    const out = requiredNativeModules(root)!;
    expect(Object.keys(out)).toEqual(["a1", "b1", "c1", "d1", "zeta"]);
    expect(out.a1).toBe("~2.1.0");
  });

  it("skips and reports native deps with non-numeric specs", () => {
    app({ w: "workspace:^", f: "file:../f", g: "github:x/y", n: "1.0.0-beta.1", ok: ">=1.2.0 <2" });
    for (const n of ["w", "f", "g", "n", "ok"]) pkg(n, [], ["android"]);
    const skipped: string[] = [];
    expect(requiredNativeModules(root, skipped)).toEqual({ ok: ">=1.2.0 <2" });
    expect(skipped.sort()).toEqual(["f@file:../f", "g@github:x/y", "n@1.0.0-beta.1", "w@workspace:^"]);
  });

  it("ignores dependencies that are not installed", () => {
    app({ missing: "^1.0.0" });
    expect(requiredNativeModules(root)).toBeUndefined();
  });
});
