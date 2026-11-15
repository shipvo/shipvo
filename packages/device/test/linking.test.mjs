import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [] };
const { Linking, Share, receiveShare, openUrl } = await import("../src/index.web.ts");
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

test("Share.share records message, url and source app, and logs simulated", async () => {
  dev.reset();
  dev.set({ appName: "App A" });
  assert.deepEqual(await Share.share({ message: "hi", url: "https://x.dev/a" }), { action: "sharedAction" });
  const p = dev.pendingShare();
  assert.deepEqual([p.message, p.url, p.sourceApp], ["hi", "https://x.dev/a", "App A"]);
  assert.equal(dev.log().filter((l) => l.kind === "share_recorded").at(-1).simulated, true);
});

test("a second Share.share replaces the first", async () => {
  await Share.share({ message: "one" });
  await Share.share({ message: "two", url: "https://x.dev/b" });
  assert.equal(dev.pendingShare().message, "two");
  assert.equal(dev.pendingShare().url, "https://x.dev/b");
});

test("receiveShare delivers message and url to the foreground app", async () => {
  dev.reset();
  const urls = [], events = [];
  const sub = Linking.addEventListener("url", (e) => urls.push(e.url));
  const prev = globalThis.window.dispatchEvent;
  globalThis.window.dispatchEvent = (e) => { events.push(e); return true; };
  assert.equal(receiveShare({ message: "look", url: "https://x.dev/c" }), true);
  globalThis.window.dispatchEvent = prev; sub.remove();
  assert.deepEqual(urls, ["https://x.dev/c"]);
  assert.deepEqual(events.find((e) => e.type === "pn:share").detail, { message: "look", url: "https://x.dev/c" });
  assert.equal(dev.log().filter((l) => l.kind === "share_received").at(-1).simulated, true);
});
