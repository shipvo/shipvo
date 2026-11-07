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
