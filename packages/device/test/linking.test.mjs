import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [] };
const { Linking, openUrl } = await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;

test("getInitialURL is null, follows setInitialUrl, and clears with null", async () => {
  assert.equal(await Linking.getInitialURL(), null);
  dev.setInitialUrl("myapp://start");
  assert.equal(await Linking.getInitialURL(), "myapp://start");
  dev.setInitialUrl(null);
  assert.equal(await Linking.getInitialURL(), null);
});

test("a url listener receives openUrl until removed", async () => {
  const seen = [];
  const sub = Linking.addEventListener("url", (e) => seen.push(e.url));
  await openUrl("myapp://item/42");
  assert.deepEqual(seen, ["myapp://item/42"]);
  sub.remove();
  await openUrl("myapp://item/43");
  assert.deepEqual(seen, ["myapp://item/42"]);
});

test("openURL delivers to listeners and logs a simulated entry", async () => {
  dev.reset();
  const seen = [];
  const sub = Linking.addEventListener("url", (e) => seen.push(e.url));
  await Linking.openURL("myapp://item/7");
  sub.remove();
  assert.deepEqual(seen, ["myapp://item/7"]);
  const entry = dev.log().filter((l) => l.kind === "url_opened").at(-1);
  assert.equal(entry.simulated, true);
  assert.deepEqual(entry.detail, { url: "myapp://item/7", handled: true });
});

test("Share.share hands {message,url} to __pnShare and resolves sharedAction", async () => {
  const { Share } = await import("../src/index.web.ts");
  const calls = [];
  globalThis.__pnShare = async (s) => { calls.push(s); };
  const r = await Share.share({ message: "hi", url: "myapp://x", title: "t" });
  assert.deepEqual(calls, [{ message: "hi", url: "myapp://x" }]);
  assert.deepEqual(r, { action: "sharedAction" });
  delete globalThis.__pnShare;
});

test("Share.share resolves when no simulator hook is present", async () => {
  const { Share } = await import("../src/index.web.ts");
  delete globalThis.__pnShare;
  assert.deepEqual(await Share.share({ message: "solo" }), { action: "sharedAction" });
});

test("receiveShare logs, dispatches pn:share and calls URL listeners only with a url", () => {
  dev.reset();
  const events = [];
  const prev = globalThis.window.dispatchEvent;
  globalThis.window.dispatchEvent = (e) => { events.push(e.type); return true; };
  const seen = [];
  return import("../src/index.web.ts").then(({ Linking }) => {
    const s = Linking.addEventListener("url", (e) => seen.push(e.url));
    dev.receiveShare({ message: "only text" });
    assert.deepEqual(seen, []);
    dev.receiveShare({ message: "m", url: "myapp://s/1" });
    s.remove();
    globalThis.window.dispatchEvent = prev;
    assert.deepEqual(seen, ["myapp://s/1"]);
    assert.equal(events.filter((t) => t === "pn:share").length, 2);
    assert.equal(dev.log().filter((l) => l.kind === "share_received").length, 2);
  });
});
