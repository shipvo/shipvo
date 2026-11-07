import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ts = read("../src/native.ts");
const swift = read("../ios/Sources/ShipvoCapacitor/ShipvoPlugin.swift");
const java = read("../android/src/main/java/dev/shipvo/capacitor/ShipvoPlugin.java");

const iface = ts.slice(ts.indexOf("export interface ShipvoNativePlugin"), ts.indexOf("\n}\n", ts.indexOf("export interface ShipvoNativePlugin")));
const methods = [...iface.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]!).sort();

describe("iOS plugin matches the TypeScript definitions and the Android plugin", () => {
  it("reads nine methods from ShipvoNativePlugin", () => {
    expect(methods).toEqual(["fileClear", "fileList", "fileRead", "fileRemove", "fileWrite", "kvGet", "kvSet", "serve", "status"]);
  });
  it("registers exactly those methods with the bridge", () => {
    const registered = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((m) => m[1]!).sort();
    expect(registered).toEqual(methods);
  });
  it("implements each method as an @objc function", () => {
    for (const m of methods) expect(swift).toContain(`@objc func ${m}(_ call: CAPPluginCall)`);
  });
  it("uses the same plugin name and result keys as Android", () => {
    expect(swift).toContain('jsName = "Shipvo"');
    expect(java).toContain('@CapacitorPlugin(name = "Shipvo")');
    for (const key of ["value", "data", "names", "serving"]) {
      expect(swift).toContain(`"${key}"`);
      expect(java).toContain(`"${key}"`);
    }
    for (const m of methods) expect(java).toContain(`public void ${m}(PluginCall call)`);
  });
  it("is declared for Capacitor's iOS sync", () => {
    const pkg = JSON.parse(read("../package.json"));
    expect(pkg.capacitor.ios.src).toBe("ios");
    expect(read("../Package.swift")).toContain('.library(name: "ShipvoCapacitor"');
    expect(read("../../../apps/capacitor-sample/ios/App/CapApp-SPM/Package.swift")).toContain('"ShipvoCapacitor"');
  });
});
