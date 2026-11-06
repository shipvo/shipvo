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

test("a link opens the app that owns the scheme, which becomes current and records the URL", async () => {
  const { openLink, loadProfile } = await import("./apps.mjs");
  const st = loadProfile({ apps: [{ id: "a", name: "A", schemes: ["aaa"] }, { id: "b", name: "B", schemes: ["Bee://", "bee2"] }] });
  const nav = { where: "home" };
  const app = openLink(st, "bee://item/42", nav);
  assert.equal(app.id, "b"); assert.equal(st.current_app, "b"); assert.equal(nav.where, "app");
  assert.deepEqual(st.links, [{ app: "b", url: "bee://item/42" }]);
  assert.deepEqual(st.log.at(-1), { ...st.log.at(-1), name: "open_url", app: "b", source: "simulated", url: "bee://item/42" });
});

test("an unknown scheme is no_handler and text without a scheme is invalid_url", async () => {
  const { openLink, loadProfile } = await import("./apps.mjs");
  const st = loadProfile({ apps: [{ id: "a", name: "A", schemes: ["aaa"] }] });
  assert.throws(() => openLink(st, "nope://x"), { code: "no_handler" });
  assert.throws(() => openLink(st, "just words"), { code: "invalid_url" });
  assert.throws(() => openLink(st, ""), { code: "invalid_url" });
  assert.throws(() => openLink(st, "https://example.com"), { code: "no_handler" });
  assert.equal(st.current_app, null); assert.equal(st.links.length, 0);
});

test("only apps that accept shares are targets; a share brings the target to the front", async () => {
  const { shareToApp, shareTargets, loadProfile } = await import("./apps.mjs");
  const st = loadProfile({ apps: [{ id: "a", name: "A" }, { id: "n", name: "Notes", shares: true }] });
  assert.deepEqual(shareTargets(st), [{ id: "n", name: "Notes" }]);
  assert.throws(() => shareToApp(st, "a", { message: "hi" }), { code: "not_share_target" });
  assert.throws(() => shareToApp(st, "zz", { message: "hi" }), { code: "not_installed" });
  shareToApp(st, "n", { message: "hi", url: "https://x.test" });
  assert.equal(st.current_app, "n"); assert.equal(st.shared[0].message, "hi");
  assert.equal(st.log.at(-1).source, "simulated");
});

test("apps without a schemes array or shares flag do not throw: no_handler and not a target", async () => {
  const { findHandler, shareTargets, shareToApp, loadProfile } = await import("./apps.mjs");
  const st = loadProfile({});
  st.installed_apps.push({ id: "raw", name: "Raw", url: "x" }); // skips entry()
  assert.throws(() => findHandler(st, "raw://x"), { code: "no_handler" });
  assert.deepEqual(shareTargets(st), []);
  assert.throws(() => shareToApp(st, "raw", { message: "hi" }), { code: "not_share_target" });
  // installApp goes through entry(): a Store entry without schemes/shares gets [] and false; with them it keeps them.
  const s2 = installApp(loadProfile({}), "notes", [{ id: "bare", name: "Bare", url: "x" }, { id: "notes", name: "N", url: "x", schemes: ["notes"], shares: true }]);
  installApp(s2, "bare", [{ id: "bare", name: "Bare", url: "x" }]);
  const [n, b] = s2.installed_apps;
  assert.deepEqual([n.schemes, n.shares, b.schemes, b.shares], [["notes"], true, [], false]);
});
