// Per-app device permissions: the rules and the consent card in the Store, Android and iOS skins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderFrame } from "./frame.mjs";
import { loadProfile, installApp, setPermission, describeApps, consentCardHtml, permissionRowsHtml, createApps, appsClientScript } from "./apps.mjs";
import { settingsClientScript } from "./settings.mjs";

const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const catalog = [{ id: "remind", name: "Remind Me", url: "fixture://remind", declared: ["notifications", "camera"] }, { id: "plain", name: "Plain", url: "fixture://plain" }];

test("the consent card lists every declared permission with a switch", () => {
  const html = consentCardHtml(catalog[0]);
  for (const p of ["notifications", "camera"]) assert.match(html, new RegExp(`data-perm="${p}"`));
  assert.equal((html.match(/data-part="consent-switch"/g) ?? []).length, 2);
});

test("install stores one answer per declared permission and list output reports them", () => {
  const st = createApps(); st.store = catalog;
  installApp(st, "remind", catalog, undefined, { camera: false, bogus: true });
  assert.deepEqual(st.installed_apps[0].permissions, { notifications: true, camera: false });
  installApp(st, "plain", catalog);
  assert.equal(st.installed_apps[1].permissions, undefined);
  assert.match(describeApps(st), /permissions: notifications allowed, camera denied/);
});

test("setPermission changes one answer and rejects bad input", () => {
  const st = createApps(); installApp(st, "remind", catalog);
  setPermission(st, "remind", "camera", false);
  assert.equal(st.installed_apps[0].permissions.camera, false);
  assert.equal(code(() => setPermission(st, "remind", "contacts", true)), "not_declared");
  assert.equal(code(() => setPermission(st, "remind", "nope", true)), "unknown_permission");
  assert.equal(code(() => setPermission(st, "ghost", "camera", true)), "not_installed");
  assert.equal(code(() => setPermission(st, "remind", "camera", "yes")), "bad_value");
});

test("answers persist through a phone.json profile", () => {
  const st = loadProfile({ apps: [{ id: "remind", name: "Remind Me", permissions: { notifications: false, camera: true, junk: true } }] });
  assert.deepEqual(st.installed_apps[0].permissions, { notifications: false, camera: true });
  assert.match(permissionRowsHtml(st), /data-perm="notifications" aria-checked="false"/);
});

// The card and the Settings toggles in Chromium, both skins.
const require = createRequire(import.meta.url);
for (const style of ["android", "ios"]) {
  test(`${style}: the Store shows the consent card, and Settings toggles a permission`, async () => {
    const { chromium } = require("playwright");
    const b = await chromium.launch(); const page = await b.newPage();
    const seed = { apps: [], store: catalog };
    const f = renderFrame({ skin: style, screen: `<iframe id="app" srcdoc="&lt;p&gt;hi&lt;/p&gt;"></iframe>` });
    await page.setContent(`<style>${f.css}</style>${f.html}<script>${appsClientScript("app", seed)}</script><script>${settingsClientScript("app")}</script>`);
    await page.evaluate(() => document.querySelector('[data-part="store-icon"]').click());
    await page.evaluate(() => document.querySelector('[data-part="store-install"][data-app="remind"]').click());
    assert.equal(await page.locator('[data-part="consent-switch"]').count(), 2);
    await page.evaluate(() => document.querySelector('[data-part="consent-switch"][data-perm="camera"]').click());
    await page.evaluate(() => document.querySelector('[data-part="consent-install"]').click());
    await page.waitForSelector('[data-part="installed-app"][data-app="remind"]', { state: "attached" });
    await page.evaluate(() => document.querySelector('[data-part="settings-icon"]').click());
    await page.waitForSelector('[data-part="perm-switch"][data-perm="camera"]', { state: "attached" });
    assert.equal(await page.getAttribute('[data-part="perm-switch"][data-perm="camera"]', "aria-checked"), "false");
    await page.evaluate(() => document.querySelector('[data-part="perm-switch"][data-perm="camera"]').click());
    assert.equal(await page.getAttribute('[data-part="perm-switch"][data-perm="camera"]', "aria-checked"), "true");
    await b.close();
  });
}

test("the default Store lists an app that declares permissions, and its consent card shows them", () => {
  const st = createApps();
  const app = st.store.find((a) => a.id === "tidewatch");
  assert.deepEqual(app.declared, ["notifications", "location"]);
  assert.match(consentCardHtml(app), /data-perm="location"/);
  installApp(st, "tidewatch");
  assert.deepEqual(st.installed_apps[0].permissions, { notifications: true, location: true });
});

test("the marketplace mapping carries an app's declared device permissions into its listing", () => {
  assert.match(appsClientScript("app", {}), /permissions\.device/);
});

for (const style of ["android", "ios"]) {
  test(`${style}: the default Store shows the consent card for Tide Watch`, async () => {
    const { chromium } = require("playwright");
    const b = await chromium.launch(); const page = await b.newPage();
    const f = renderFrame({ skin: style, screen: `<iframe id="app" srcdoc="&lt;p&gt;hi&lt;/p&gt;"></iframe>` });
    await page.setContent(`<style>${f.css}</style>${f.html}<script>${appsClientScript("app", {})}</script>`);
    await page.evaluate(() => document.querySelector('[data-part="store-icon"]').click());
    await page.evaluate(() => document.querySelector('[data-part="store-install"][data-app="tidewatch"]').click());
    assert.equal(await page.locator('[data-part="consent-switch"]').count(), 2);
    await b.close();
  });
}
