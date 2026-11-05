import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("app.plugin.js", () => {
  const withShipvo = require("../app.plugin.js") as (
    config: Record<string, unknown>,
    props?: Record<string, unknown>,
  ) => Record<string, unknown>;

  it("writes the trust root and app id to Info.plist and AndroidManifest", () => {
    const config = withShipvo({}, {
      baseUrl: "https://example.test",
      publicKey: "public-key",
      appId: "app-id",
      shellMajor: 2,
      hermesBytecodeVersions: [96, 98],
      nativeModules: { "@scope/pkg": "2.1.0" },
    });

    expect(config.extra).toEqual({
      shipvo: { baseUrl: "https://example.test", appId: "app-id", shellMajor: 2 },
    });
    expect((config as any).modResults.ShipvoBaseURL).toBe("https://example.test");
    expect((config as any).modResults.ShipvoPublicKey).toBe("public-key");
    expect((config as any).modResults.ShipvoAppId).toBe("app-id");
    expect((config as any).modResults.ShipvoShellMajor).toBe("2");
    expect((config as any).modResults.ShipvoHermesBytecodeVersions).toBe("96,98");
    expect((config as any).modResults.ShipvoNativeModules).toBe("@scope/pkg@2.1.0");
  });

  it("omits optional fields when they are not provided", () => {
    const config = withShipvo({}, {
      baseUrl: "https://example.test",
      publicKey: "public-key",
      appId: "app-id",
    });

    expect((config as any).modResults.ShipvoHermesBytecodeVersions).toBeUndefined();
    expect((config as any).modResults.ShipvoNativeModules).toBeUndefined();
  });

  it("rejects an empty hermesBytecodeVersions array", () => {
    expect(() => withShipvo({}, {
      baseUrl: "https://example.test",
      publicKey: "public-key",
      appId: "app-id",
      hermesBytecodeVersions: [],
    })).toThrow();
  });

  it("rejects a native module version containing a space or comma", () => {
    expect(() => withShipvo({}, {
      baseUrl: "https://example.test",
      publicKey: "public-key",
      appId: "app-id",
      nativeModules: { "@scope/pkg": "2.1.0 beta" },
    })).toThrow();

    expect(() => withShipvo({}, {
      baseUrl: "https://example.test",
      publicKey: "public-key",
      appId: "app-id",
      nativeModules: { "@scope/pkg": "2.1.0,2.2.0" },
    })).toThrow();
  });

  it("requires baseUrl, publicKey and appId", () => {
    expect(() => withShipvo({}, { publicKey: "public-key", appId: "app-id" })).toThrow();
    expect(() => withShipvo({}, { baseUrl: "https://example.test", appId: "app-id" })).toThrow();
    expect(() => withShipvo({}, { baseUrl: "https://example.test", publicKey: "public-key" })).toThrow();
  });
});
