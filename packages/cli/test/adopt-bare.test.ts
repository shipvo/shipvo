import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { androidMetaData, applyAndroidConfig, writeAndroidConfig, findAndroidManifest, checkExpoModules } from "../src/adopt-bare";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "rn088", "AndroidManifest.xml");
const plugin = join(here, "..", "..", "runtime", "app.plugin.js");
const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-adopt-"));

const cases = [
  { baseUrl: "https://cp.test", publicKey: "PUB=", appId: "shop" },
  { baseUrl: "https://cp.test", publicKey: "PUB=", appId: "shop", shellMajor: 3, hermesBytecodeVersions: [96, 98], nativeModules: { "react-native-svg": "15.0.0", "@a/b": "1.2.3" } },
];

// Runs the real app.plugin.js with a stub of expo/config-plugins and returns what it writes.
function pluginPairs(props: object): Array<[string, string]> {
  const app: { "meta-data": Array<{ $: Record<string, string> }> } = { "meta-data": [] };
  const stub = {
    withInfoPlist: (c: unknown) => c,
    withAndroidManifest: (c: unknown, fn: (c: unknown) => unknown) => fn({ modResults: {} }) && c,
    AndroidConfig: { Manifest: {
      getMainApplicationOrThrow: () => app,
      addMetaDataItemToMainApplication: (a: typeof app, n: string, v: string) => a["meta-data"].push({ $: { "android:name": n, "android:value": v } }),
    } },
  };
  const mod: { exports: (c: object, p: object) => unknown } = { exports: undefined as never };
  new Function("require", "module", readFileSync(plugin, "utf8"))(() => stub, mod);
  mod.exports({}, props);
  return app["meta-data"].map((m) => [m.$["android:name"], m.$["android:value"]]);
}

function pairsInXml(xml: string): Array<[string, string]> {
  return [...xml.matchAll(/<meta-data android:name="(dev\.shipvo\.[^"]+)" android:value="([^"]*)"\/>/g)].map((m) => [m[1], m[2]]);
}

describe("androidMetaData", () => {
  it.each(cases)("matches app.plugin.js (%#)", (props) => {
    expect(androidMetaData(props)).toEqual(pluginPairs(props));
    expect(pairsInXml(applyAndroidConfig(readFileSync(fixture, "utf8"), props))).toEqual(pluginPairs(props));
  });
});

const base = cases[0];
const bad: Array<[string, object]> = [
  ["negative bytecode version", { hermesBytecodeVersions: [-1] }],
  ["fractional bytecode version", { hermesBytecodeVersions: [1.5] }],
  ["non-array bytecode versions", { hermesBytecodeVersions: "96" }],
  ["comma in module version", { nativeModules: { a: "1,2" } }],
  ["space in module version", { nativeModules: { a: "1 2" } }],
  ["space in module name", { nativeModules: { "a b": "1" } }],
  ["empty module name", { nativeModules: { "": "1" } }],
  ["empty module version", { nativeModules: { a: "" } }],
  ["non-string module version", { nativeModules: { a: 1 } }],
  ["array nativeModules", { nativeModules: ["a@1"] }],
  ["null nativeModules", { nativeModules: null }],
  ["string nativeModules", { nativeModules: "a@1" }],
];

describe("invalid input", () => {
  it.each(bad)("%s throws here and in app.plugin.js", (_n, extra) => {
    const props = { ...base, ...extra };
    expect(() => androidMetaData(props as never)).toThrow(/adopt-bare/);
    expect(() => applyAndroidConfig(readFileSync(fixture, "utf8"), props as never)).toThrow();
    expect(() => pluginPairs(props)).toThrow(/@shipvo\/runtime/);
  });
});

describe("manifest edge cases", () => {
  it("throws on an unterminated <application", () => {
    expect(() => applyAndroidConfig('<manifest><application android:name="a"', base)).toThrow(/unterminated/);
  });
  it("throws on a missing </application>", () => {
    expect(() => applyAndroidConfig("<manifest><application>\n<activity/>\n</manifest>", base)).toThrow(/no <\/application>/);
  });
  it("adds android:value to an existing meta-data that has none", () => {
    const xml = '<manifest><application>\n  <meta-data android:name="dev.shipvo.APP_ID"/>\n</application></manifest>';
    const out = applyAndroidConfig(xml, base);
    expect(out).toContain('<meta-data android:name="dev.shipvo.APP_ID" android:value="shop"/>');
    expect(out.match(/dev\.shipvo\.APP_ID/g)).toHaveLength(1);
    expect(applyAndroidConfig(out, base)).toBe(out);
  });
  it("escapes & \" < in values on add and update", () => {
    const a = { ...base, baseUrl: "https://cp.test/?a=1&b=2" };
    const added = applyAndroidConfig(readFileSync(fixture, "utf8"), a);
    expect(added).toContain('android:value="https://cp.test/?a=1&amp;b=2"');
    const b = { ...base, baseUrl: 'https://x.test/?q="<"&z=1' };
    const updated = applyAndroidConfig(added, b);
    expect(updated).toContain('android:value="https://x.test/?q=&quot;&lt;&quot;&amp;z=1"');
    expect(applyAndroidConfig(updated, b)).toBe(updated);
  });
});

describe("writeAndroidConfig", () => {
  const original = readFileSync(fixture, "utf8");
  it("adds values, keeps everything else, and is idempotent", () => {
    const d = tmp(); const p = join(d, "AndroidManifest.xml"); copyFileSync(fixture, p);
    expect(writeAndroidConfig(p, cases[0])).toBe(true);
    const once = readFileSync(p, "utf8");
    expect(once.replace(/ *<meta-data android:name="dev\.shipvo\.[^\n]*\n/g, "")).toBe(original);
    expect(writeAndroidConfig(p, cases[0])).toBe(false);
    expect(readFileSync(p, "utf8")).toBe(once);
  });
  it("updates a changed value in place, only that element", () => {
    const first = applyAndroidConfig(original, cases[0]);
    const next = applyAndroidConfig(first, { ...cases[0], baseUrl: "https://other.test" });
    expect(next).toBe(first.replace("https://cp.test", "https://other.test"));
    expect(applyAndroidConfig(next, { ...cases[0], baseUrl: "https://other.test" })).toBe(next);
  });
  it("adds only missing items when some exist", () => {
    const first = applyAndroidConfig(original, cases[0]);
    const next = applyAndroidConfig(first, cases[1]);
    expect(pairsInXml(next)).toEqual(pluginPairs(cases[1]));
  });
  it("handles a self-closed <application />", () => {
    const xml = '<manifest xmlns:android="x">\n  <application android:name=".A" android:label="a>b" />\n</manifest>\n';
    const out = applyAndroidConfig(xml, cases[0]);
    expect(out).toContain('<application android:name=".A" android:label="a>b">');
    expect(out).toContain("</application>");
    expect(pairsInXml(out)).toEqual(pluginPairs(cases[0]));
    expect(applyAndroidConfig(out, cases[0])).toBe(out);
  });
  it("ignores an <application> inside a comment", () => {
    const xml = "<manifest><!-- <application/> -->\n<application>\n</application></manifest>";
    expect(pairsInXml(applyAndroidConfig(xml, cases[0]))).toHaveLength(4);
  });
  it("throws without <application>", () => {
    expect(() => applyAndroidConfig("<manifest/>", cases[0])).toThrow(/no <application>/);
  });
});

describe("findAndroidManifest", () => {
  it("finds the standard path or returns null", () => {
    const d = tmp();
    expect(findAndroidManifest(d)).toBeNull();
    mkdirSync(join(d, "android/app/src/main"), { recursive: true });
    writeFileSync(join(d, "android/app/src/main/AndroidManifest.xml"), "<manifest/>");
    expect(findAndroidManifest(d)).toBe(join(d, "android/app/src/main/AndroidManifest.xml"));
  });
});

describe("checkExpoModules", () => {
  function app(expo: boolean) {
    const d = tmp();
    const j = join(d, "android/app/src/main/java/com/x"); mkdirSync(j, { recursive: true });
    mkdirSync(join(d, "ios/X"), { recursive: true });
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: expo ? { expo: "~55.0.0" } : { "react-native": "0.88.0" } }));
    writeFileSync(join(j, "MainApplication.kt"), expo ? "import expo.modules.ApplicationLifecycleDispatcher\nclass MainApplication" : "class MainApplication");
    writeFileSync(join(d, "ios/X/AppDelegate.swift"), expo ? "import Expo\nclass AppDelegate: ExpoAppDelegate {}" : "import UIKit\nclass AppDelegate: UIResponder {}");
    return d;
  }
  it("is installed when expo and both setups are present", () => {
    expect(checkExpoModules(app(true))).toEqual({ installed: true, expoPackage: true, android: true, ios: true, plan: [] });
  });
  it("accepts a scene-based iOS project", () => {
    const d = app(true);
    writeFileSync(join(d, "ios/X/AppDelegate.swift"), "import UIKit\nclass AppDelegate: UIResponder {}");
    writeFileSync(join(d, "ios/X/SceneDelegate.swift"), "import Expo\nclass SceneDelegate: UIResponder, UIWindowSceneDelegate {}");
    expect(checkExpoModules(d)).toEqual({ installed: true, expoPackage: true, android: true, ios: true, plan: [] });
  });
  it("returns the install step when missing, and installs nothing", () => {
    const d = app(false);
    const r = checkExpoModules(d);
    expect(r).toEqual({ installed: false, expoPackage: false, android: false, ios: false, plan: ["npx install-expo-modules@latest"] });
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).dependencies.expo).toBeUndefined();
  });
  it("reports a missing project as not installed", () => {
    expect(checkExpoModules(tmp()).plan).toEqual(["npx install-expo-modules@latest"]);
  });
});
