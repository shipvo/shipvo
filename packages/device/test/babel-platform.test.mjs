// The simulator build's Babel plugin: Platform.OS and Platform.select follow the simulated phone, in the app's own files only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const plugin = require("../babel.cjs");

const build = (code, { filename = "/app/src/Screen.js", sim = "1" } = {}) => {
  const before = process.env.PN_SIM;
  if (sim) process.env.PN_SIM = sim; else delete process.env.PN_SIM;
  try { return babel.transformSync(code, { filename, babelrc: false, configFile: false, plugins: [plugin] }).code; }
  finally { if (before === undefined) delete process.env.PN_SIM; else process.env.PN_SIM = before; }
};
/** Runs built code as a phone of `platform` would, with a Platform object that says "web" as react-native-web's does. */
const run = (code, platform) => {
  const Platform = { OS: "web", select: (o) => ("web" in o ? o.web : o.default) };
  globalThis.__PN_SIM__ = platform ? { device: { platform } } : undefined;
  try { return new Function("Platform", `return (${code.replace(/;\s*$/, "")});`)(Platform); }
  finally { delete globalThis.__PN_SIM__; }
};

test("Platform.OS is the session's platform when the code runs", () => {
  const code = build(`Platform.OS === "ios" ? "padding" : "height"`);
  assert.equal(run(code, "ios"), "padding");
  assert.equal(run(code, "android"), "height");
  assert.equal(run(code, undefined), "height", "no session platform means android, the simulator's default");
});

test("Platform.select picks the platform's key, then native, then default", () => {
  const code = build(`Platform.select({ ios: "i", native: "n", default: "d" })`);
  assert.equal(run(code, "ios"), "i");
  assert.equal(run(code, "android"), "n");
  assert.equal(run(build(`Platform.select({ web: "w", default: "d" })`), "android"), "d");
  assert.equal(run(build(`Platform.select({ android: Platform.OS, default: "d" })`), "android"), "android");
});

test("files in node_modules and builds without PN_SIM are left as they are", () => {
  const src = `Platform.OS === "web" ? 1 : 2;`;
  assert.equal(build(src, { filename: "/app/node_modules/lib/index.js" }), src);
  assert.equal(build(src, { sim: "" }), src);
  assert.equal(build(`Platform.select({ web: 1 });`, { filename: "C:\\app\\node_modules\\lib\\index.js" }), `Platform.select({\n  web: 1\n});`);
});

test("other Platform members and an assignment to Platform.OS are not touched", () => {
  assert.equal(build(`Platform.Version;`), `Platform.Version;`);
  assert.equal(build(`Platform.OS = "x";`), `Platform.OS = "x";`);
  assert.equal(build(`other.OS;`), `other.OS;`);
});
