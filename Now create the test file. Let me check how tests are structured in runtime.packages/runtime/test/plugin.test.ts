import { describe, it, expect } from "vitest";
import withShipvo from "../app.plugin.js";

function run(props: any) {
  const config: any = { extra: {} };
  return withShipvo(config, props);
}

describe("app.plugin", () => {
  it("writes both props to manifest and plist", () => {
    const cfg = run({ baseUrl: "u", publicKey: "k", appId: "a", hermesBytecodeVersions: [96, 98], nativeModules: { "a": "1.0.0", "@s/b": "2.1.0" } });
    const app = cfg.modResults.android.app[0];
    const meta = app["meta-data"];
    expect(meta.find((m: any) => m.$["android:name"] === "dev.shipvo.HERMES_BYTECODE_VERSIONS")?.$["android:value"]).toBe("96,98");
    expect(meta.find((m: any) => m.$["android:name"] === "dev.shipvo.NATIVE_MODULES")?.$["android:value"]).toBe("a@1.0.0,@s/b@2.1.0");
    expect(cfg.modResults.ios.ShipvoHermesBytecodeVersions).toBe("96,98");
    expect(cfg.modResults.ios.ShipvoNativeModules).toBe("a@1.0.0,@s/b@2.1.0");
  });

  it("writes nothing when props omitted", () => {
    const cfg = run({ baseUrl: "u", publicKey: "k", appId: "a" });
    const app = cfg.modResults.android.app[0];
    const meta = app["meta-data"];
    expect(meta.find((m: any) => m.$["android:name"] === "dev.shipvo.HERMES_BYTECODE_VERSIONS")).toBeUndefined();
    expect(meta.find((m: any) => m.$["android:name"] === "dev.shipvo.NATIVE_MODULES")).toBeUndefined();
    expect(cfg.modResults.ios.ShipvoHermesBytecodeVersions).toBeUndefined();
    expect(cfg.modResults.ios.ShipvoNativeModules).toBeUndefined();
  });

  it("throws on non-integer version", () => {
    expect(() => run({ baseUrl: "u", publicKey: "k", appId: "a", hermesBytecodeVersions: [1.5] })).toThrow();
  });

  it("throws on empty package name", () => {
    expect(() => run({ baseUrl: "u", publicKey: "k", appId: "a", nativeModules: { "": "1" } })).toThrow();
  });

  it("throws on non-array / non-object input", () => {
    expect(() => run({ baseUrl: "u", publicKey: "k", appId: "a", hermesBytecodeVersions: "x" })).toThrow();
    expect(() => run({ baseUrl: "u", publicKey: "k", appId: "a", nativeModules: ["x"] })).toThrow();
  });
});
