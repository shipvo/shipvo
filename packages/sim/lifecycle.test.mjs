import test from "node:test";
import assert from "node:assert/strict";
import { lifecycle, assertUnlocked } from "./lifecycle.mjs";

const fakePage = () => {
  const g = { locked: false, log: [] };
  globalThis.__pnDevice = { lock() { g.locked = true; g.log.push("lock"); }, unlock() { g.locked = false; g.log.push("unlock"); }, locked: () => g.locked, frameEvent: (k) => g.log.push(k) };
  return { g, reloads: 0, evaluate: async (fn, arg) => fn(arg), reload: async function () { this.reloads++; g.locked = false; }, waitForFunction: async function (fn) { if (this.noDevice) throw new Error("timeout"); return fn(); } };
};
test("lock then unlock flips the device state and logs both", async () => {
  const p = fakePage();
  assert.deepEqual(await lifecycle(p, "lock"), { locked: true });
  assert.deepEqual(await lifecycle(p, "unlock"), { locked: false });
  assert.deepEqual(p.g.log, ["lock", "unlock"]);
});
test("restart reloads the page once, then logs the restart", async () => {
  const p = fakePage(); await lifecycle(p, "lock");
  assert.deepEqual(await lifecycle(p, "restart"), { locked: false });
  assert.equal(p.reloads, 1);
  assert.equal(p.g.log.at(-1), "restart");
});
test("an unknown action is refused", async () => {
  await assert.rejects(() => lifecycle(fakePage(), "explode"), /unknown lifecycle action/);
});
test("restart fails with a clear error when the app never comes back", async () => {
  const p = fakePage(); p.noDevice = true;
  await assert.rejects(() => lifecycle(p, "restart"), /did not come back after the restart/);
});
test("assertUnlocked refuses while locked and passes after unlock", async () => {
  const p = fakePage();
  await assertUnlocked(p);
  await lifecycle(p, "lock");
  await assert.rejects(() => assertUnlocked(p), /the phone is locked/);
  await lifecycle(p, "unlock");
  await assertUnlocked(p);
});
