// Installed apps: the rules (phone.json, install, switch, uninstall) and the Store screen in Chromium, in both skins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { renderFrame, statusClientScript } from "./frame.mjs";
import { loadProfile, installApp, uninstallApp, switchApp, describeApps, profilePatch, AppsError, STORE_FIXTURE } from "./apps.mjs";
import { createNav } from "./nav.mjs";

const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const profile = { apps: [{ id: "tide", name: "Tide & Tackle", url: "fixture://tide", version: "1.0.0" }, { id: "notes", name: "Pocket Notes", version: "0.3.1" }], current_app: "tide", settings: { dark_mode: true, font_size: "large" } };

test("a phone.json with two apps gives the same phone every time", () => {
  const a = loadProfile(profile), b = loadProfile(JSON.stringify(profile));
  assert.deepEqual(a.installed_apps, b.installed_apps);
  assert.equal(a.installed_apps.length, 2); assert.equal(a.current_app, "tide");
  assert.deepEqual(profilePatch(a), { darkMode: true, fontSize: "large" });
});

test("a bad phone.json is a typed bad_profile error", () => {
  for (const bad of ["{", "[]", { apps: [{ id: "A b" }] }, { apps: [{ id: "a" }, { id: "a" }] }, { apps: [], current_app: "x" }, { settings: { nope: 1 } }]) assert.equal(code(() => loadProfile(bad)), "bad_profile");
});

test("switch changes current_app; uninstall removes the app and goes home", () => {
  const st = loadProfile(profile), nav = createNav();
  switchApp(st, "notes", nav);
  assert.equal(st.current_app, "notes"); assert.equal(nav.where, "app");
  uninstallApp(st, "notes", nav);
  assert.deepEqual(st.installed_apps.map((a) => a.id), ["tide"]);
  assert.equal(st.current_app, null); assert.equal(nav.where, "home");
  assert.match(describeApps(st), /button "Tide & Tackle"/);
});

test("typed errors: unknown_app, already_installed, not_installed", () => {
  const st = loadProfile(profile);
  assert.equal(code(() => installApp(st, "ghost")), "unknown_app");
  assert.equal(code(() => installApp(st, "tide")), "already_installed");
  assert.equal(code(() => uninstallApp(st, "weather")), "not_installed");
  assert.equal(code(() => switchApp(st, "weather")), "not_installed");
  installApp(st, "weather"); assert.equal(st.installed_apps.length, 3);
});

test("installs are logged as simulated", () => {
  const st = loadProfile({}); installApp(st, "notes");
  assert.deepEqual(st.log.map((l) => [l.name, l.app, l.source]), [["install_app", "notes", "simulated"]]);
});

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.env.APPS_SHOTS;
test("the Store screen lists the fixture apps and a tap installs one, in both skins", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="<p>app</p>"></iframe>` });
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin, { apps: [{ id: "tide", name: "Tide & Tackle" }] })}</script>`);
      await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
      assert.equal(await p.getByRole("button", { name: "Tide & Tackle" }).count(), 1); // seeded app is on the home screen
      await p.getByRole("button", { name: "Store" }).click();
      const rows = await p.locator('[data-part="store-rows"] .sf-store-row').count();
      assert.equal(rows, STORE_FIXTURE.length);
      assert.equal(await p.getByRole("button", { name: "Install Pocket Notes" }).count(), 1);
      assert.equal(await p.getByRole("button", { name: "Install Tide & Tackle" }).count(), 0); // already installed
      if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${skin}-store.png`, clip: await p.locator('[data-part="phone-body"]').boundingBox() }); }
      await p.getByRole("button", { name: "Install Pocket Notes" }).click();
      assert.equal(await p.getByRole("button", { name: "Install Pocket Notes" }).count(), 0);
      await p.getByRole("button", { name: "Close" }).click();
      assert.equal(await p.getByRole("button", { name: "Pocket Notes" }).count(), 1); // now on the home screen
      await p.getByRole("button", { name: "Pocket Notes" }).click();
      await p.waitForFunction(() => document.querySelector('[data-part="home-screen"]').hidden); // tap opens the app
      await p.close().catch(() => {});
    }
  } finally { await b.close(); }
});

import { resolveUrl as resolveUrlFn } from "./apps.mjs";
import { test as urlTest } from "node:test";
import urlAssert from "node:assert/strict";
{
  const st = loadProfile({ apps: [{ id: "shop", name: "Shop", schemes: ["myapp", "mailto:"] }, { id: "notes" }] });
  const code = (url, s = st) => { try { resolveUrlFn(s, url); } catch (e) { return e.code; } };
  urlTest("resolveUrl: text without a scheme is invalid_url", () => { for (const u of ["item/3", "", "://x", 5]) urlAssert.equal(code(u), "invalid_url"); });
  urlTest("resolveUrl: an undeclared scheme is no_handler", () => urlAssert.equal(code("other://x"), "no_handler"));
  urlTest("resolveUrl: a declared scheme returns the owning app", () => {
    for (const u of ["myapp://item/42", "myapp:item/3", "MAILTO:a@b.c"]) urlAssert.equal(resolveUrlFn(st, u).app, "shop");
  });
  urlTest("resolveUrl: shipvo.json declarations count, and with no schemes the URL passes through", () => {
    urlAssert.equal(resolveUrlFn(loadProfile({ apps: [{ id: "a" }] }), "tel:1", [{ id: "me", schemes: ["tel"] }]).app, "me");
    urlAssert.deepEqual(resolveUrlFn(loadProfile({ apps: [{ id: "a" }] }), "https://x.dev"), { passthrough: true });
  });
}
