// withShipvoSim's nativeFiles option: in a simulator build the app's own relative imports prefer X.native.js, as on a phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const withShipvoSim = createRequire(import.meta.url)("../metro.cjs");

/** Resolves `moduleName` through the wrapped config and reports whether the native file was preferred. */
function prefers(options, { moduleName = "./Price", origin = "/app/src/cases.js", platform = "web", sim = "1" } = {}) {
  const before = process.env.PN_SIM;
  if (sim) process.env.PN_SIM = sim; else delete process.env.PN_SIM;
  try {
    const config = withShipvoSim({ resolver: {} }, options);
    const ctx = { originModulePath: origin, resolveRequest: (c) => ({ preferNative: c.preferNativePlatform === true }) };
    return config.resolver.resolveRequest(ctx, moduleName, platform).preferNative;
  } finally { if (before === undefined) delete process.env.PN_SIM; else process.env.PN_SIM = before; }
}

test("with nativeFiles, an app file's relative import prefers the native file in a simulator build", () => {
  assert.equal(prefers({ nativeFiles: true }), true);
  assert.equal(prefers({ nativeFiles: true }, { moduleName: "../ui/Sheet" }), true);
});

test("without the option nothing changes", () => {
  assert.equal(prefers(undefined), false);
  assert.equal(prefers({}), false);
});

test("packages, files in node_modules, other platforms and builds without PN_SIM are left alone", () => {
  assert.equal(prefers({ nativeFiles: true }, { moduleName: "react-native" }), false);
  assert.equal(prefers({ nativeFiles: true }, { origin: "/app/node_modules/lib/index.js" }), false);
  assert.equal(prefers({ nativeFiles: true }, { platform: "ios" }), false);
  assert.equal(prefers({ nativeFiles: true }, { sim: "" }), false);
});

test("an earlier resolveRequest in the config still runs, with the same preference", () => {
  process.env.PN_SIM = "1";
  try {
    const seen = [];
    const config = withShipvoSim({ resolver: { resolveRequest: (c, name) => { seen.push([name, c.preferNativePlatform === true]); return { type: "empty" }; } } }, { nativeFiles: true });
    config.resolver.resolveRequest({ originModulePath: "/app/App.js" }, "./Price", "web");
    assert.deepEqual(seen, [["./Price", true]]);
  } finally { delete process.env.PN_SIM; }
});
