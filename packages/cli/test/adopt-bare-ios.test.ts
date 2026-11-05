import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plist from "plist";
import { describe, expect, it } from "vitest";
import { adoptNextSteps, findIosInfoPlist, iosPlistEntries, writeIosConfig } from "../src/adopt-bare";

const require = createRequire(import.meta.url);
const fixture = new URL("./fixtures/rn088/Info.plist", import.meta.url).pathname;
const base = { baseUrl: "https://cp.example", publicKey: "KEY", appId: "shop" };

// Run app.plugin.js on a plain object, as packages/runtime/test/plugin.test.ts does.
function pluginPlist(props: object): Record<string, string> {
  const id = require.resolve("expo/config-plugins", { paths: [new URL("../../runtime/", import.meta.url).pathname] });
  const out: Record<string, string> = {};
  require.cache[id] = {
    id, filename: id, loaded: true, children: [], paths: [],
    exports: {
      withInfoPlist: (c: any, fn: any) => (fn({ ...c, modResults: out }), c),
      withAndroidManifest: (c: any) => c,
      AndroidConfig: {},
    },
  } as any;
  const p = require.resolve("../../runtime/app.plugin.js");
  delete require.cache[p];
  require(p)({}, props);
  return out;
}

function tmpPlist(): string {
  const dir = mkdtempSync(join(tmpdir(), "adopt-"));
  const f = join(dir, "Info.plist");
  copyFileSync(fixture, f);
  return f;
}

const table: Array<[string, any]> = [
  ["required props", base],
  ["shell major", { ...base, shellMajor: 3 }],
  ["bytecode versions", { ...base, hermesBytecodeVersions: [96, 98] }],
  ["native modules", { ...base, nativeModules: { "react-native-mmkv": "3.1.0", "@scope/x": "1.0.0" } }],
  ["all props", { ...base, shellMajor: 2, hermesBytecodeVersions: [96], nativeModules: { a: "1.0.0" } }],
];

describe("writeIosConfig", () => {
  it.each(table)("matches app.plugin.js: %s", (_n, props) => {
    expect(iosPlistEntries(props)).toEqual(pluginPlist(props));
    const f = tmpPlist();
    writeIosConfig(f, props);
    const dict = plist.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(pluginPlist(props))) expect(dict[k]).toBe(v);
  });

  it("rejects the same bad input as the plugin", () => {
    expect(() => iosPlistEntries({ ...base, hermesBytecodeVersions: [96.5] })).toThrow(/hermesBytecodeVersions/);
    expect(() => iosPlistEntries({ ...base, nativeModules: { "": "1.0.0" } })).toThrow(/empty package name/);
    expect(() => iosPlistEntries({ ...base, nativeModules: { a: "1,2" } })).toThrow(/comma/);
    expect(() => iosPlistEntries({ ...base, appId: "" })).toThrow(/required/);
  });

  it("adds values and keeps other keys and their order", () => {
    const f = tmpPlist();
    const before = Object.keys(plist.parse(readFileSync(fixture, "utf8")) as object);
    expect(writeIosConfig(f, base)).toBe(true);
    const after = plist.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    expect(Object.keys(after)).toEqual([...before, "ShipvoBaseURL", "ShipvoPublicKey", "ShipvoAppId", "ShipvoShellMajor"]);
    expect(after.ShipvoBaseURL).toBe("https://cp.example");
    expect(after.ShipvoShellMajor).toBe("1");
    expect(after.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true });
    expect(after.CFBundleExecutable).toBe("$(EXECUTABLE_NAME)");
  });

  it("changes nothing when run twice", () => {
    const f = tmpPlist();
    writeIosConfig(f, base);
    const once = readFileSync(f, "utf8");
    expect(writeIosConfig(f, base)).toBe(false);
    expect(readFileSync(f, "utf8")).toBe(once);
  });

  it("updates a changed value in place", () => {
    const f = tmpPlist();
    writeIosConfig(f, base);
    writeIosConfig(f, { ...base, baseUrl: "https://other.example" });
    const keys = Object.keys(plist.parse(readFileSync(f, "utf8")) as object);
    expect(keys.filter((k) => k === "ShipvoBaseURL")).toHaveLength(1);
    expect((plist.parse(readFileSync(f, "utf8")) as any).ShipvoBaseURL).toBe("https://other.example");
  });
});

describe("findIosInfoPlist", () => {
  it("finds ios/<name>/Info.plist and skips Pods and tests", () => {
    const dir = mkdtempSync(join(tmpdir(), "adopt-"));
    for (const n of ["HelloBare", "HelloBareTests", "Pods"]) {
      mkdirSync(join(dir, "ios", n), { recursive: true });
      writeFileSync(join(dir, "ios", n, "Info.plist"), "");
    }
    mkdirSync(join(dir, "ios", "HelloBare.xcodeproj"));
    expect(findIosInfoPlist(dir)).toBe(join(dir, "ios", "HelloBare", "Info.plist"));
  });

  it("returns undefined without an ios folder", () => {
    expect(findIosInfoPlist(mkdtempSync(join(tmpdir(), "adopt-")))).toBeUndefined();
  });
});

describe("adoptNextSteps", () => {
  it("lists pod install, rebuild and a dry run in order", () => {
    const t = adoptNextSteps();
    expect(t.indexOf("cd ios && pod install")).toBeGreaterThan(-1);
    expect(t.indexOf("Rebuild both apps")).toBeGreaterThan(t.indexOf("pod install"));
    expect(t.indexOf("shipvo publish --dry-run")).toBeGreaterThan(t.indexOf("Rebuild"));
  });
});
