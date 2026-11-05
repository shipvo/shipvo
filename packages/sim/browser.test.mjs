import test from "node:test";
import assert from "node:assert/strict";
import { launchErrorMessage } from "./chromium-hint.mjs";
import { detectPackageManager, devInstallCommand, resolvePlaywright, launchResolved, autoInstallOff } from "./browser.mjs";

const missing = "browserType.launch: Executable doesn't exist at /x/chrome";
function fakePw(plan) { // plan: array of results per launch call: "ok" or an error message
  const calls = [];
  return { calls, chromium: { launch: async (o = {}) => { calls.push(o); const r = plan.shift(); if (r === "ok") return { browser: true }; throw new Error(r); } } };
}
const mkDeps = (over = {}) => { const ran = [], logs = []; return { ran, logs, env: {}, platform: "darwin", run: (c, a) => { ran.push([c, ...a]); return 0; }, runAsync: async (c, a) => { ran.push([c, ...a]); return 0; }, log: (m) => logs.push(m), ...over }; };

test("package manager comes from the lockfile", () => {
  const ex = (names) => (p) => names.some((n) => p.endsWith(n));
  assert.equal(detectPackageManager("/a", ex(["pnpm-lock.yaml"])), "pnpm");
  assert.equal(detectPackageManager("/a", ex(["yarn.lock"])), "yarn");
  assert.equal(detectPackageManager("/a", ex(["bun.lockb"])), "bun");
  assert.equal(detectPackageManager("/a", ex(["bun.lock"])), "bun");
  assert.equal(detectPackageManager("/a", ex(["package-lock.json"])), "npm");
  assert.equal(detectPackageManager("/a", ex([])), "npm");
  assert.deepEqual(devInstallCommand("npm", "playwright"), { cmd: "npm", args: ["install", "--save-dev", "playwright"] });
  assert.deepEqual(devInstallCommand("yarn", "playwright").args, ["add", "--dev", "playwright"]);
  assert.deepEqual(devInstallCommand("pnpm", "playwright").args, ["add", "-D", "playwright"]);
});

test("system Chrome is used first, with no install", async () => {
  const pw = fakePw(["ok"]); const d = mkDeps();
  await launchResolved(pw, {}, d);
  assert.deepEqual(pw.calls, [{ channel: "chrome" }]); assert.equal(d.ran.length, 0);
});

test("Edge is tried when Chrome is missing", async () => {
  const pw = fakePw([missing, "ok"]); const d = mkDeps();
  await launchResolved(pw, {}, d);
  assert.deepEqual(pw.calls, [{ channel: "chrome" }, { channel: "msedge" }]); assert.equal(d.ran.length, 0);
});

test("Playwright's cached Chromium is used before any install", async () => {
  const pw = fakePw([missing, missing, "ok"]); const d = mkDeps();
  await launchResolved(pw, {}, d);
  assert.deepEqual(pw.calls[2], {}); assert.equal(d.ran.length, 0);
});

test("otherwise Chromium is installed once, with a progress line, then launched", async () => {
  const pw = fakePw([missing, missing, missing, "ok"]); const d = mkDeps();
  await launchResolved(pw, {}, d);
  assert.deepEqual(d.ran, [["npx", "playwright", "install", "chromium"]]);
  assert.match(d.logs[0], /Installing Chromium/);
});

test("SHIPVO_NO_AUTO_INSTALL turns the install off and names the command", async () => {
  const pw = fakePw([missing, missing, missing]); const d = mkDeps({ env: { SHIPVO_NO_AUTO_INSTALL: "1" } });
  await assert.rejects(launchResolved(pw, {}, d), /Run: npx playwright install chromium/);
  assert.equal(d.ran.length, 0);
  assert.equal(autoInstallOff({ SHIPVO_NO_AUTO_INSTALL: "1" }), true);
  assert.equal(autoInstallOff({}), false);
});

test("a failed install says what to run", async () => {
  const pw = fakePw([missing, missing, missing]); const d = mkDeps({ runAsync: async () => 1 });
  await assert.rejects(launchResolved(pw, {}, d), /could not install Chromium. Run: npx playwright install chromium/);
});

test("on Linux, missing system libraries print install-deps", async () => {
  const pw = fakePw(["error while loading shared libraries: libnss3.so"]); const d = mkDeps({ platform: "linux" });
  await assert.rejects(launchResolved(pw, {}, d), /npx playwright install-deps chromium/);
  const mac = fakePw(["error while loading shared libraries: libnss3.so", missing, missing, missing, missing]);
  await assert.rejects(launchResolved(mac, {}, mkDeps({ platform: "darwin", runAsync: async () => 1 })), /could not install Chromium/);
});

test("--chromium path wins and skips the search", async () => {
  const pw = fakePw(["ok"]);
  await launchResolved(pw, { executablePath: "/bin/chrome" }, mkDeps());
  assert.deepEqual(pw.calls, [{ executablePath: "/bin/chrome" }]);
});

test("a missing playwright package is installed with the detected package manager, then loaded", () => {
  let installed = false; const pw = { chromium: {} };
  const bad = () => { throw new Error("nope"); };
  const d = mkDeps({
    exists: (p) => p.endsWith("pnpm-lock.yaml"),
    requireFrom: () => (id) => { if (!installed) bad(); return id === "playwright" ? pw : { version: "1.63.0" }; },
    requireHere: bad, globalRoot: () => "/g",
    run: (c, a) => { d.ran.push([c, ...a]); installed = true; return 0; },
  });
  const r = resolvePlaywright("/app", d);
  assert.equal(r.pw, pw); assert.equal(r.version, "1.63.0");
  assert.deepEqual(d.ran, [["pnpm", "add", "-D", "playwright"]]);
  assert.match(d.logs.join("\n"), /pnpm add -D playwright/);
});

test("a missing playwright with the opt-out fails with the command and installs nothing", () => {
  const bad = () => { throw new Error("nope"); };
  const d = mkDeps({ env: { SHIPVO_NO_AUTO_INSTALL: "1" }, requireFrom: () => bad, requireHere: bad, globalRoot: () => "/g" });
  assert.throws(() => resolvePlaywright("/app", d), /npm install --save-dev playwright/);
  assert.equal(d.ran.length, 0);
});

test("launchResolved waits for the async Chromium install before launching again", async () => {
  const order = [];
  const pw = { chromium: { launch: async () => { order.push("launch"); if (order.filter((x) => x === "launch").length < 4) throw new Error(missing); return {}; } } };
  const d = mkDeps({ runAsync: async () => { order.push("install-start"); await new Promise((r) => setTimeout(r, 20)); order.push("install-end"); return 0; } });
  await launchResolved(pw, {}, d);
  assert.deepEqual(order, ["launch", "launch", "launch", "install-start", "install-end", "launch"]);
});

test("on Linux, the install-deps command survives launchErrorMessage", async () => {
  const pw = fakePw(["error while loading shared libraries: libnss3.so", "error while loading shared libraries: libnss3.so", "error while loading shared libraries: libnss3.so"]);
  const err = await launchResolved(pw, {}, mkDeps({ platform: "linux" })).catch((e) => e);
  assert.match(launchErrorMessage(err.message), /npx playwright install-deps chromium/);
});

test("on Linux, a broken system Chrome falls through to the next option", async () => {
  const pw = fakePw(["error while loading shared libraries: libnss3.so", missing, "ok"]);
  assert.deepEqual(await launchResolved(pw, {}, mkDeps({ platform: "linux" })), { browser: true });
});
