// Installed apps: the rules (phone.json, install, switch, uninstall) and the Store screen in Chromium, in both skins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { renderFrame, statusClientScript } from "./frame.mjs";
import { loadProfile, installApp, uninstallApp, switchApp, describeApps, profilePatch, AppsError, STORE_FIXTURE, resolveUrl } from "./apps.mjs";
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

{
  const st = loadProfile({ apps: [{ id: "shop", name: "Shop", schemes: ["myapp", "mailto:"] }, { id: "notes" }] });
  const code = (url, s = st) => { try { resolveUrl(s, url); } catch (e) { return e.code; } };
  test("resolveUrl: text without a scheme is invalid_url", () => { for (const u of ["item/3", "", "://x", 5]) assert.equal(code(u), "invalid_url"); });
  test("resolveUrl: an undeclared scheme is no_handler", () => assert.equal(code("other://x"), "no_handler"));
  test("resolveUrl: a declared scheme returns the owning app", () => {
    for (const u of ["myapp://item/42", "myapp:item/3", "MAILTO:a@b.c"]) assert.equal(resolveUrl(st, u).app, "shop");
  });
  test("resolveUrl: shipvo.json declarations count, and with no schemes the URL passes through", () => {
    assert.equal(resolveUrl(loadProfile({ apps: [{ id: "a" }] }), "tel:1", [{ id: "me", schemes: ["tel"] }]).app, "me");
    assert.deepEqual(resolveUrl(loadProfile({ apps: [{ id: "a" }] }), "https://x.dev"), { passthrough: true });
  });
}

// Placement: pin, hide, order and schedule apps on the home screen.
import { arrangeApp, homeApps, appVisible } from "./apps.mjs";
{
  const mk = () => loadProfile({ apps: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] });
  const ids = (st, d) => homeApps(st, d).map((x) => x.id).join("");
  const MON = new Date("2026-11-09T10:00:00"), SAT = new Date("2026-11-14T10:00:00");
  test("home order: pinned first, then position, then install order", () => {
    const st = mk(); assert.equal(ids(st), "abc");
    arrangeApp(st, "c", { pinned: true }); assert.equal(ids(st), "cab");
    arrangeApp(st, "b", { position: 0 }); assert.equal(ids(st), "cba");
    arrangeApp(st, "c", { pinned: false }); assert.equal(ids(st), "bac");
  });
  test("a hidden app is off the home screen, still installed, and described as hidden", () => {
    const st = mk(); arrangeApp(st, "a", { hidden: true });
    assert.equal(ids(st), "bc"); assert.equal(st.installed_apps.length, 3);
    assert.match(describeApps(st), /"A" \(a\): hidden; switch_app still opens it/);
  });
  test("a schedule shows the app only on its days and hours, also across midnight", () => {
    const st = mk();
    arrangeApp(st, "a", { schedule: { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" } });
    arrangeApp(st, "b", { schedule: { days: ["sat", "sun"] } });
    assert.equal(ids(st, MON), "ac"); assert.equal(ids(st, SAT), "bc");
    assert.equal(appVisible({ placement: { schedule: { days: ["mon"], from: "22:00", to: "02:00" } } }, new Date("2026-11-09T23:30:00")), true);
    assert.equal(appVisible({ placement: { schedule: { days: ["mon"], from: "22:00", to: "02:00" } } }, new Date("2026-11-09T12:00:00")), false);
    assert.match(describeApps(st, SAT), /"A" \(a\): not showing now, scheduled mon,tue,wed,thu,fri 08:00-18:00/);
    arrangeApp(st, "a", { schedule: null }); assert.equal(ids(st, SAT), "abc");
  });
  test("placement errors are typed", () => {
    const st = mk(); const code = (f) => { try { f(); } catch (e) { return e.code; } };
    assert.equal(code(() => arrangeApp(st, "zzz", { pinned: true })), "not_installed");
    assert.equal(code(() => arrangeApp(st, "a", { pinned: "yes" })), "bad_placement");
    assert.equal(code(() => arrangeApp(st, "a", { position: -1 })), "bad_placement");
    assert.equal(code(() => arrangeApp(st, "a", { schedule: { days: ["noday"] } })), "bad_placement");
    assert.equal(code(() => arrangeApp(st, "a", { schedule: { from: "9am" } })), "bad_placement");
    assert.equal(code(() => arrangeApp(st, "a", { colour: "red" })), "bad_placement");
  });
}
