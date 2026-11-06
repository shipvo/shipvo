import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const base = { baseUrl: "https://cp.example", publicKey: "KEY", appId: "shop" };

let plist: Record<string, string>;
let meta: Record<string, string>;

// Replace expo/config-plugins in the require cache so the mods run on plain objects.
function load() {
  const id = require.resolve("expo/config-plugins");
  require.cache[id] = {
    id, filename: id, loaded: true, children: [], paths: [],
    exports: {
      withInfoPlist: (c: any, fn: any) => (fn({ ...c, modResults: plist }), c),
      withAndroidManifest: (c: any, fn: any) => (fn({ ...c, modResults: {} }), c),
      AndroidConfig: { Manifest: {
        getMainApplicationOrThrow: () => ({}),
        addMetaDataItemToMainApplication: (_a: unknown, k: string, v: string) => { meta[k] = v; },
      } },
    },
  } as any;
  const p = require.resolve("../app.plugin.js");
  delete require.cache[p];
  return require(p) as (c: any, props: any) => any;
}

describe("config plugin", () => {
  beforeEach(() => { plist = {}; meta = {}; });

  it("writes both props on Android and iOS", () => {
    load()({}, { ...base, hermesBytecodeVersions: [96, 98], nativeModules: { "react-native-mmkv": "3.1.0", "@scope/x": "1.0.0" } });
    expect(meta["dev.shipvo.HERMES_BYTECODE_VERSIONS"]).toBe("96,98");
    expect(meta["dev.shipvo.NATIVE_MODULES"]).toBe("react-native-mmkv@3.1.0,@scope/x@1.0.0");
    expect(plist.ShipvoHermesBytecodeVersions).toBe("96,98");
    expect(plist.ShipvoNativeModules).toBe("react-native-mmkv@3.1.0,@scope/x@1.0.0");
  });

  it("writes hermesEngine on Android and iOS, and rejects a bad one", () => {
    load()({}, { ...base, hermesEngine: "250829098.0.10" });
    expect(meta["dev.shipvo.HERMES_ENGINE"]).toBe("250829098.0.10");
    expect(plist.ShipvoHermesEngine).toBe("250829098.0.10");
    expect(() => load()({}, { ...base, hermesEngine: "latest" })).toThrow(/hermesEngine/);
    expect(() => load()({}, { ...base, hermesEngine: 5 })).toThrow(/hermesEngine/);
  });

  it("writes nothing without the props", () => {
    load()({}, base);
    expect(meta["dev.shipvo.BASE_URL"]).toBe("https://cp.example");
    expect(Object.keys(meta).filter((k) => /HERMES|NATIVE/.test(k))).toEqual([]);
    expect(Object.keys(plist).filter((k) => /Hermes|NativeModules/.test(k))).toEqual([]);
  });

  it("throws on a non-integer bytecode version", () => {
    expect(() => load()({}, { ...base, hermesBytecodeVersions: [96.5] })).toThrow(/hermesBytecodeVersions/);
    expect(() => load()({}, { ...base, hermesBytecodeVersions: ["96"] })).toThrow(/hermesBytecodeVersions/);
    expect(() => load()({}, { ...base, hermesBytecodeVersions: 96 })).toThrow(/array/);
  });

  it("throws on an empty package name or bad version", () => {
    expect(() => load()({}, { ...base, nativeModules: { "": "1.0.0" } })).toThrow(/empty package name/);
    expect(() => load()({}, { ...base, nativeModules: { a: "" } })).toThrow(/version/);
    expect(() => load()({}, { ...base, nativeModules: { a: "1,2" } })).toThrow(/comma/);
  });
});

it("keeps reportEvents: false in expo.extra.shipvo, and omits it otherwise", () => {
  const plugin = require("../app.plugin.js");
  const base = { baseUrl: "https://x.test", publicKey: "AAAA", appId: "a" };
  expect(plugin({ name: "n" }, { ...base, reportEvents: false }).extra.shipvo.reportEvents).toBe(false);
  expect("reportEvents" in plugin({ name: "n" }, base).extra.shipvo).toBe(false);
});
