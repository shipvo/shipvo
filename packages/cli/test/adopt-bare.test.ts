import { afterEach, beforeEach, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plist from "plist";
import {
  checkExpoModules, findAndroidManifest, findIosInfoPlist, installExpoModules, INSTALL_EXPO_MODULES,
  writeAndroidConfig, writeIosConfig, type ShipvoNativeValues,
} from "../src/adopt-bare";

const fx = join(__dirname, "fixtures/rn088");
let tmp = "";
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "bare-")); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// One table, used for both our writers and the real app.plugin.js.
const TABLE: { name: string; props: ShipvoNativeValues }[] = [
  { name: "required only", props: { baseUrl: "https://ota.example.com", publicKey: "AAAA", appId: "app_1" } },
  {
    name: "all options",
    props: {
      baseUrl: "https://ota.example.com", publicKey: "BBBB", appId: "app_2", shellMajor: 3,
      hermesBytecodeVersions: [96, 98], nativeModules: { "react-native-svg": "15.0.0", "expo-camera": "17.0.1" },
    },
  },
];

// Runs app.plugin.js with stubbed config-plugins and returns what it would write.
function pluginOutput(props: ShipvoNativeValues) {
  const src = readFileSync(join(__dirname, "../../runtime/app.plugin.js"), "utf8");
  const plistOut: Record<string, unknown> = {};
  const meta: Record<string, string> = {};
  const stub = {
    withInfoPlist: (c: any, fn: any) => { fn({ modResults: plistOut }); return c; },
    withAndroidManifest: (c: any, fn: any) => { fn({ modResults: {} }); return c; },
    AndroidConfig: { Manifest: {
      getMainApplicationOrThrow: () => ({}),
      addMetaDataItemToMainApplication: (_a: unknown, k: string, v: string) => { meta[k] = v; },
    } },
  };
  const mod: { exports: any } = { exports: {} };
  new Function("require", "module", src)((id: string) => { if (id === "expo/config-plugins") return stub; throw new Error(id); }, mod);
  mod.exports({}, props);
  return { plistOut, meta };
}

for (const { name, props } of TABLE) {
  it(`writes what app.plugin.js writes (${name})`, () => {
    const p = join(tmp, "Info.plist"), m = join(tmp, "AndroidManifest.xml");
    copyFileSync(join(fx, "Info.plist"), p);
    copyFileSync(join(fx, "AndroidManifest.xml"), m);
    writeIosConfig(p, props);
    writeAndroidConfig(m, props);
    const expected = pluginOutput(props);
    const dict = plist.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const got: Record<string, unknown> = {};
    for (const k of Object.keys(expected.plistOut)) got[k] = dict[k];
    expect(got).toEqual(expected.plistOut);
    const xml = readFileSync(m, "utf8");
    const gotMeta: Record<string, string> = {};
    for (const mm of xml.matchAll(/<meta-data android:name="(dev\.shipvo\.[^"]+)" android:value="([^"]*)"\/>/g)) gotMeta[mm[1]] = mm[2];
    expect(gotMeta).toEqual(expected.meta);
  });
}

it("iOS: adds values, keeps other keys in order, and a second run changes nothing", () => {
  const p = join(tmp, "Info.plist");
  copyFileSync(join(fx, "Info.plist"), p);
  const before = plist.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  expect(writeIosConfig(p, TABLE[0].props)).toBe(true);
  const once = readFileSync(p, "utf8");
  const after = plist.parse(once) as Record<string, unknown>;
  expect(Object.keys(after).slice(0, Object.keys(before).length)).toEqual(Object.keys(before));
  for (const k of Object.keys(before)) expect(after[k]).toEqual(before[k]);
  expect(after.ShipvoShellMajor).toBe("1");
  expect(writeIosConfig(p, TABLE[0].props)).toBe(false);
  expect(readFileSync(p, "utf8")).toBe(once);
});

it("Android: only adds meta-data; the rest is byte for byte; a second run changes nothing", () => {
  const m = join(tmp, "AndroidManifest.xml");
  copyFileSync(join(fx, "AndroidManifest.xml"), m);
  const original = readFileSync(m, "utf8");
  expect(writeAndroidConfig(m, TABLE[1].props)).toBe(true);
  const once = readFileSync(m, "utf8");
  const stripped = once.split("\n").filter((l) => !l.includes("dev.shipvo.")).join("\n");
  expect(stripped).toBe(original);
  expect(once.indexOf("dev.shipvo.BASE_URL")).toBeLessThan(once.indexOf("</application>"));
  expect(writeAndroidConfig(m, TABLE[1].props)).toBe(false);
  expect(readFileSync(m, "utf8")).toBe(once);
});

it("Android: updates an existing value in place", () => {
  const m = join(tmp, "AndroidManifest.xml");
  copyFileSync(join(fx, "AndroidManifest.xml"), m);
  writeAndroidConfig(m, TABLE[0].props);
  writeAndroidConfig(m, { ...TABLE[0].props, publicKey: "CCCC" });
  const xml = readFileSync(m, "utf8");
  expect(xml.match(/dev\.shipvo\.PUBLIC_KEY/g)).toHaveLength(1);
  expect(xml).toContain('android:value="CCCC"');
});

it("rejects bad option values like app.plugin.js", () => {
  const p = join(tmp, "Info.plist");
  copyFileSync(join(fx, "Info.plist"), p);
  expect(() => writeIosConfig(p, { ...TABLE[0].props, hermesBytecodeVersions: [-1] })).toThrow(/non-negative/);
  expect(() => writeIosConfig(p, { ...TABLE[0].props, nativeModules: { a: "1 2" } })).toThrow(/comma or space/);
});

function makeApp(opts: { expo: boolean }) {
  mkdirSync(join(tmp, "ios/Hello.xcodeproj"), { recursive: true });
  mkdirSync(join(tmp, "ios/Hello"), { recursive: true });
  mkdirSync(join(tmp, "ios/HelloTests"), { recursive: true });
  mkdirSync(join(tmp, "android/app/src/main/java/com/hello"), { recursive: true });
  writeFileSync(join(tmp, "ios/Hello.xcodeproj/project.pbxproj"),
    'INFOPLIST_FILE = HelloTests/Info.plist;\nINFOPLIST_FILE = Hello/Info.plist;\nINFOPLIST_FILE = "$(SRCROOT)/Hello/Info.plist";\n');
  copyFileSync(join(fx, "Info.plist"), join(tmp, "ios/Hello/Info.plist"));
  copyFileSync(join(fx, "Info.plist"), join(tmp, "ios/HelloTests/Info.plist"));
  copyFileSync(join(fx, "AndroidManifest.xml"), join(tmp, "android/app/src/main/AndroidManifest.xml"));
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: opts.expo ? { expo: "58.0.0" } : { "react-native": "0.88.1" } }));
  writeFileSync(join(tmp, "ios/Hello/AppDelegate.swift"), opts.expo ? "import Expo\nclass AppDelegate: ExpoAppDelegate {}" : "class AppDelegate: RCTAppDelegate {}");
  writeFileSync(join(tmp, "android/app/src/main/java/com/hello/MainApplication.kt"),
    opts.expo ? "ApplicationLifecycleDispatcher.onApplicationCreate(this)" : "class MainApplication : Application()");
}

it("finds the app's Info.plist (not the tests') and the manifest", () => {
  makeApp({ expo: true });
  expect(findIosInfoPlist(tmp)).toBe(join(tmp, "ios/Hello/Info.plist"));
  expect(findAndroidManifest(tmp)).toBe(join(tmp, "android/app/src/main/AndroidManifest.xml"));
});

it("falls back to ios/<name>/Info.plist without an Xcode project entry", () => {
  makeApp({ expo: true });
  rmSync(join(tmp, "ios/Hello.xcodeproj"), { recursive: true });
  expect(findIosInfoPlist(tmp)).toBe(join(tmp, "ios/Hello/Info.plist"));
});

it("checkExpoModules says what is missing and plans install-expo-modules", () => {
  makeApp({ expo: false });
  const r = checkExpoModules(tmp);
  expect(r.installed).toBe(false);
  expect(r.missing).toHaveLength(3);
  expect(r.planStep).toBe(INSTALL_EXPO_MODULES);
});

it("checkExpoModules passes with Expo Modules set up", () => {
  makeApp({ expo: true });
  expect(checkExpoModules(tmp)).toEqual({ installed: true, missing: [] });
});

it("installs nothing without confirmation; runs with --yes or a yes answer", async () => {
  const ran: string[] = [];
  const run = (cmd: string) => { ran.push(cmd); return 0; };
  expect(await installExpoModules(tmp, { run })).toBe(false);
  expect(await installExpoModules(tmp, { run, confirm: async () => false })).toBe(false);
  expect(ran).toEqual([]);
  expect(await installExpoModules(tmp, { run, confirm: async () => true })).toBe(true);
  expect(await installExpoModules(tmp, { run, yes: true })).toBe(true);
  expect(ran).toEqual([INSTALL_EXPO_MODULES, INSTALL_EXPO_MODULES]);
});
