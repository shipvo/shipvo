import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBrowser, systemBrowserPaths } from "./browser-resolver.mjs";
import { launchErrorMessage } from "./chromium-hint.mjs";

const pw = { chromium: { executablePath: () => "/cache/chromium" } };
const base = { pw, env: {}, platform: "linux", log: () => {} };
const only = (...paths) => (p) => paths.includes(p);
const noRun = () => { throw new Error("must not run"); };

test("system chrome wins", () => {
  const r = resolveBrowser({ ...base, fileExists: only(systemBrowserPaths("chrome", "linux", {})[0], "/cache/chromium"), run: noRun });
  assert.deepEqual(r, { channel: "chrome" });
});
test("msedge when chrome is absent", () => {
  const r = resolveBrowser({ ...base, fileExists: only(systemBrowserPaths("msedge", "linux", {})[0]), run: noRun });
  assert.deepEqual(r, { channel: "msedge" });
});
test("playwright cache", () => {
  assert.deepEqual(resolveBrowser({ ...base, fileExists: only("/cache/chromium"), run: noRun }), {});
});
test("one-time install", () => {
  const calls = []; const logs = [];
  const r = resolveBrowser({ ...base, log: (m) => logs.push(m), fileExists: () => calls.length > 0, run: (c, a) => { calls.push([c, a]); return { status: 0 }; } });
  assert.deepEqual(r, {});
  assert.deepEqual(calls, [["npx", ["playwright", "install", "chromium"]]]);
  assert.equal(logs.length, 1);
});
test("--chromium path wins over everything", () => {
  const r = resolveBrowser({ ...base, executablePath: "/my/chrome", fileExists: () => true, run: noRun });
  assert.deepEqual(r, { executablePath: "/my/chrome" });
});
test("install exits 0 but no browser appears", () => {
  assert.throws(() => resolveBrowser({ ...base, fileExists: () => false, run: () => ({ status: 0 }) }), /no browser was installed/);
});
test("install failure includes the spawn error", () => {
  assert.throws(() => resolveBrowser({ ...base, fileExists: () => false, run: () => ({ status: null, error: new Error("spawn npx ENOENT") }) }), /ENOENT/);
});
test("install failure throws", () => {
  assert.throws(() => resolveBrowser({ ...base, fileExists: () => false, run: () => ({ status: 1 }) }), /failed/);
});
test("opt-out throws naming the command and does not install", () => {
  assert.throws(() => resolveBrowser({ ...base, env: { SHIPVO_NO_AUTO_INSTALL: "1" }, fileExists: () => false, run: noRun }), /npx playwright install chromium/);
});
test("windows and mac paths", () => {
  assert.ok(systemBrowserPaths("chrome", "win32", { PROGRAMFILES: "C:\\PF" })[0].startsWith("C:\\PF"));
  assert.match(systemBrowserPaths("msedge", "darwin", {})[0], /Microsoft Edge/);
});
test("linux missing library hint", () => {
  const m = launchErrorMessage("browserType.launch: error while loading shared libraries: libnss3.so");
  assert.match(m, /npx playwright install-deps chromium/);
});
