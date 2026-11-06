import test from "node:test";
import assert from "node:assert/strict";
import { createUpdate, checkForUpdate, applyUpdate, bootDone, updateView, bannerText, verifyPointer, UpdateError } from "./update.mjs";
import { renderFrame } from "./frame.mjs";
import { makeKey, signedPointer, stubControlPlane } from "./update-fixture.mjs";

const key = makeKey();
const H2 = "<h1>Release 2</h1>";
async function setup(over = {}, html = H2) {
  const state = { pointer: signedPointer(key, 2, html, over), files: { "r2/index.html": html } };
  const cp = await stubControlPlane(state);
  const st = createUpdate({ release: 1, url: "http://x/r1" });
  return { state, cp, st, opts: { url: cp.url, publicKey: key.publicB64 } };
}

test("a good release goes checking, downloading, ready, then applied", async () => {
  const { cp, st, opts } = await setup();
  const v = await checkForUpdate(st, opts);
  assert.deepEqual([v.state, v.pending_release, v.reason], ["ready", 2, null]);
  assert.deepEqual(st.log.map((l) => l.state), ["checking", "downloading", "ready"]);
  assert.ok(st.log.every((l) => l.source === "simulated"));
  assert.equal(bannerText(st), "Simulated: update ready: release 2");
  applyUpdate(st, (n) => `http://x/u/r${n}`);
  assert.equal(updateView(st).state, "applied"); assert.equal(st.running.release, 2);
  assert.equal(st.bundles.get(2).toString(), H2);
  cp.close();
});
test("a bad signature ends idle with verify_failed and is never applied", async () => {
  const { state, cp, st, opts } = await setup();
  state.pointer.release = 3;                       // changed after signing
  const v = await checkForUpdate(st, opts);
  assert.deepEqual([v.state, v.reason], ["idle", "verify_failed"]);
  assert.throws(() => applyUpdate(st, () => "x"), (e) => e.code === "not_ready");
  assert.equal(st.running.release, 1);
  cp.close();
});
test("a wrong key and a tampered bundle are verify_failed", async () => {
  const a = await setup();
  assert.equal((await checkForUpdate(a.st, { ...a.opts, publicKey: makeKey().publicB64 })).reason, "verify_failed");
  const b = await setup(); b.state.files["r2/index.html"] = "<h1>evil</h1>";
  assert.equal((await checkForUpdate(b.st, b.opts)).reason, "verify_failed");
  assert.equal(b.st.bundles.size, 0);
  a.cp.close(); b.cp.close();
});
test("a missing bundle or an unreachable source is download_failed; verifyPointer never throws", async () => {
  const a = await setup(); delete a.state.files["r2/index.html"];
  assert.deepEqual([(await checkForUpdate(a.st, a.opts)).state, a.st.reason], ["idle", "download_failed"]);
  const st = createUpdate({ release: 1, url: "u" });
  assert.equal((await checkForUpdate(st, { url: "http://127.0.0.1:1", publicKey: key.publicB64 })).reason, "download_failed");
  assert.equal(verifyPointer({ signature: "!!" }, "bad"), false);
  a.cp.close();
});
test("no_update when the release is not newer, and not_ready before a check", async () => {
  const { cp, st, opts } = await setup();
  st.running.release = 2;
  await assert.rejects(checkForUpdate(st, opts), (e) => e instanceof UpdateError && e.code === "no_update");
  assert.equal(st.state, "idle");
  assert.throws(() => applyUpdate(st, () => "x"), (e) => e.code === "not_ready");
  await assert.rejects(checkForUpdate(createUpdate({ release: 1, url: "u" }), {}), (e) => e.code === "no_update");
  cp.close();
});
test("a signed older pointer is refused when the running release is not a plain number", async () => {
  for (const kind of ["seen", "string"]) {
    const { cp, st, opts } = await setup();          // the pointer is release 2
    if (kind === "seen") { st.running.release = undefined; st.seen.push(30); }   // a release the session ran before
    else st.running.release = "r13";
    await assert.rejects(checkForUpdate(st, opts), (e) => e instanceof UpdateError && e.code === "no_update" && /not newer/.test(e.message));
    assert.equal(st.state, "idle"); assert.equal(st.pending, null);
    cp.close();
  }
});
test("with no release known at all, a signed release is accepted", async () => {
  const { cp, st, opts } = await setup();
  st.running.release = undefined;
  assert.equal((await checkForUpdate(st, opts)).state, "ready");
  cp.close();
});
test("three failed boots revert, block the release and say crash_loop", async () => {
  const { cp, st, opts } = await setup();
  await checkForUpdate(st, opts); applyUpdate(st, (n) => `http://x/u/r${n}`);
  assert.deepEqual(bootDone(st, true), { revert: false });
  assert.deepEqual(bootDone(st, true), { revert: false });
  assert.deepEqual(bootDone(st, true), { revert: true, url: "http://x/r1" });
  const v = updateView(st);
  assert.deepEqual([v.state, v.reason, v.release, v.blocked], ["reverted", "crash_loop", 1, [2]]);
  assert.equal(bannerText(st), "Simulated: update reverted (crash_loop): back on release 1");
  await assert.rejects(checkForUpdate(st, opts), (e) => e.code === "no_update");
  assert.equal(updateView(st).state, "reverted");
  cp.close();
});
test("a good boot confirms the release, so later crashes do not revert it", async () => {
  const { cp, st, opts } = await setup();
  await checkForUpdate(st, opts); applyUpdate(st, () => "u");
  bootDone(st, true); bootDone(st, false);
  assert.deepEqual([bootDone(st, true), bootDone(st, true), bootDone(st, true)].map((r) => r.revert), [false, false, false]);
  assert.equal(st.state, "applied");
  cp.close();
});
test("both skins carry a labelled status banner and its script", () => {
  for (const skin of ["android", "ios"]) {
    const f = renderFrame({ skin });
    assert.match(f.html, /data-part="update-banner" role="status"[^>]*aria-label="Simulated update status"/);
    assert.match(f.css, /\.sf-update/);
  }
});
