import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adopt, detectProject } from "../src/adopt";

const fx = (n: string) => new URL(`./fixtures/rn088/${n}`, import.meta.url).pathname;
let tmp = "";
const deps = { doctor: false, install: vi.fn(), installExpoModules: vi.fn(), confirm: async () => true };
const out = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
const snapshot = (d = tmp): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? snapshot(join(d, e.name)) : [`${join(d, e.name)}:${readFileSync(join(d, e.name), "utf8")}`]).sort();

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bare-"));
  mkdirSync(join(tmp, "android/app/src/main"), { recursive: true });
  mkdirSync(join(tmp, "ios/Shop"), { recursive: true });
  copyFileSync(fx("AndroidManifest.xml"), join(tmp, "android/app/src/main/AndroidManifest.xml"));
  copyFileSync(fx("Info.plist"), join(tmp, "ios/Shop/Info.plist"));
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "shop", dependencies: { "react-native": "0.88.1" } }));
  deps.install.mockClear(); deps.installExpoModules.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

it("--dry-run in a bare RN 0.88 app prints the plan and changes no file", async () => {
  const before = snapshot();
  await adopt(["--dry-run"], tmp, deps);
  expect(snapshot()).toEqual(before);
  expect(out()).toContain("bare React Native app");
  expect(out()).toContain("npx install-expo-modules@latest");
  expect(out()).toContain("AndroidManifest.xml");
  expect(out()).toContain("Info.plist");
  expect(deps.install).not.toHaveBeenCalled();
  expect(deps.installExpoModules).not.toHaveBeenCalled();
});

it("does not run install-expo-modules when the user says no", async () => {
  const before = snapshot();
  await adopt([], tmp, { ...deps, confirm: async () => false });
  expect(snapshot()).toEqual(before);
  expect(deps.installExpoModules).not.toHaveBeenCalled();
});

it("--yes writes both native files, and a second run changes nothing", async () => {
  await adopt(["--yes", "--public-key", Buffer.alloc(32, 7).toString("base64")], tmp, deps);
  const xml = readFileSync(join(tmp, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const plist = readFileSync(join(tmp, "ios/Shop/Info.plist"), "utf8");
  expect(xml).toContain("dev.shipvo.APP_ID");
  expect(xml).toContain("dev.shipvo.PUBLIC_KEY");
  expect(plist).toContain("ShipvoAppId");
  expect(plist).toContain("ShipvoPublicKey");
  expect(deps.installExpoModules).toHaveBeenCalledOnce();
  expect(out()).toContain("cd ios && pod install");
  expect(out()).toContain("shipvo publish --dry-run");
  const p = detectProject(tmp);
  expect(p.isExpo).toBe(false);

  // Installers would add the dependencies and Expo Modules; simulate that, then run again.
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "shop", dependencies: { expo: "~58.0.21", "@shipvo/runtime": "^0.1.0", "@shipvo/cli": "^0.1.0", "@shipvo/sim": "^0.1.0" }, scripts: { sim: "shipvo sim", publish: "shipvo publish", rollback: "shipvo rollback" } }));
  mkdirSync(join(tmp, "android/app/src/main/java"), { recursive: true });
  writeFileSync(join(tmp, "android/app/src/main/java/MainApplication.kt"), "import expo.modules.ApplicationLifecycleDispatcher");
  writeFileSync(join(tmp, "ios/Shop/AppDelegate.swift"), "import Expo");
  const before = snapshot();
  deps.installExpoModules.mockClear(); deps.install.mockClear();
  await adopt(["--yes"], tmp, deps);
  expect(snapshot()).toEqual(before);
  expect(deps.installExpoModules).not.toHaveBeenCalled();
});

it("does not run install-expo-modules when the Expo setup is in SceneDelegate", async () => {
  mkdirSync(join(tmp, "android/app/src/main/java/com/x"), { recursive: true });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "shop", dependencies: { "react-native": "0.88.1", expo: "~55.0.0" } }));
  writeFileSync(join(tmp, "android/app/src/main/java/com/x/MainApplication.kt"), "import expo.modules.ApplicationLifecycleDispatcher\nclass MainApplication");
  writeFileSync(join(tmp, "ios/Shop/AppDelegate.swift"), "import UIKit\nclass AppDelegate: UIResponder {}");
  writeFileSync(join(tmp, "ios/Shop/SceneDelegate.swift"), "import Expo\nclass SceneDelegate: UIResponder {}");
  await adopt([], tmp, deps);
  expect(deps.installExpoModules).not.toHaveBeenCalled();
});
