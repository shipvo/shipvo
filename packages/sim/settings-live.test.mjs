// Real pointer and keyboard runs of the Settings screen in Chromium, in both skins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.env.SETTINGS_SHOTS;
const app = `<button id=b>Home</button><script>(function(){var s={darkMode:false,fontSize:"default",boldText:false,reduceMotion:false,language:"en",rtl:false},calls=[];window.__calls=calls;
window.__pnDevice={state:{platform:PLATFORM},settings:function(){return{}},notifications:function(){return[]},system:function(){return Object.assign({},s)},set:function(p){calls.push(p);Object.assign(s,p);window.dispatchEvent(new CustomEvent("pn:system",{detail:s}))}}})()</script>`;

async function open(b, skin) {
  const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="${app.replace("PLATFORM", JSON.stringify(skin)).replace(/"/g, "&quot;")}"></iframe>` });
  const p = await b.newPage({ viewport: { width: 460, height: 960 } });
  await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin)}</script>`);
  await p.waitForFunction(() => document.getElementById("app").contentWindow.__pnDevice);
  return p;
}
const vis = (p, n) => p.$eval(`[data-part="${n}"]`, (e) => !e.hidden);
const shot = async (p, name) => { if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${name}.png`, clip: await p.locator('[data-part="phone-body"]').boundingBox() }); } };
const calls = (p) => p.evaluate(() => document.getElementById("app").contentWindow.__calls);

test("the home screen icon opens Settings; the rows change the device and are in the accessibility tree", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const p = await open(b, skin);
      await p.click('[data-part="nav-home"], [data-part="home-indicator"]', { force: true }).catch(() => {});
      await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
      await p.click('[data-part="settings-icon"]');
      assert.equal(await vis(p, "settings-screen"), true);
      assert.equal(await p.getByRole("switch").count(), 4);
      assert.equal(await p.getByRole("radio").count(), 7);
      await p.getByRole("switch", { name: "Dark mode" }).click();
      assert.deepEqual((await calls(p)).at(-1), { darkMode: true });
      assert.equal(await p.getByRole("switch", { name: "Dark mode" }).getAttribute("aria-checked"), "true"); await shot(p, `${skin}-settings`);
      await p.getByRole("radio", { name: "Largest" }).click();
      assert.deepEqual((await calls(p)).at(-1), { fontSize: "largest" });
      await p.getByRole("switch", { name: "Bold text" }).click(); await p.getByRole("switch", { name: "Reduce motion" }).click();
      await p.getByRole("radio", { name: "العربية" }).click();
      assert.deepEqual((await calls(p)).at(-1), { language: "ar", rtl: true });
      assert.equal(await p.getByRole("switch", { name: "Right-to-left layout" }).getAttribute("aria-checked"), "true");
      await p.keyboard.press("Escape"); assert.equal(await vis(p, "settings-screen"), false);
    }
  } finally { await b.close(); }
});

test("the gear in the shade opens Settings", async () => {
  const b = await chromium.launch();
  try {
    const p = await open(b, "android");
    const box = await p.locator('[data-part="top-edge"]').boundingBox();
    await p.mouse.move(box.x + 100, box.y + 6); await p.mouse.down(); await p.mouse.move(box.x + 100, box.y + 80, { steps: 6 }); await p.mouse.up();
    assert.equal(await vis(p, "notification-shade"), true);
    await p.click('[data-part="notification-shade"] [data-part="settings-gear"]');
    assert.equal(await vis(p, "settings-screen"), true); assert.equal(await vis(p, "notification-shade"), false);
    await p.click('[data-part="settings-close"]'); assert.equal(await vis(p, "settings-screen"), false);
  } finally { await b.close(); }
});
