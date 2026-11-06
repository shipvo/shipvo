// Real pointer and keyboard runs of the shade, Notification Center and Control Center in Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.env.SHADE_SHOTS;
const app = `<button id=b>Home</button><script>(function(){var s={wifi:true,darkMode:false},n=[{id:"n1",title:"Hello",body:"first",at:Date.now(),app:"Chat"},{id:"n2",title:"Bye",body:"second",at:Date.now(),app:"Mail"}],opened=[];
window.__opened=opened;window.__pnDevice={state:{platform:PLATFORM},settings:function(){return Object.assign({},s)},notifications:function(){return n.slice()},set:function(p){Object.assign(s,p)},dismiss:function(id){var l=n.length;n=n.filter(function(x){return x.id!==id});return n.length<l},clearAll:function(){n=[]},openNotification:function(id){opened.push(id);return true}}})()</script>`;

async function open(b, skin) {
  const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="${app.replace("PLATFORM", JSON.stringify(skin)).replace(/"/g, "&quot;")}"></iframe>` });
  const p = await b.newPage({ viewport: { width: 460, height: 960 } });
  await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin)}</script>`);
  const box = await p.locator('[data-part="top-edge"]').boundingBox(); box.y -= 2;
  return { p, box };
}
const pull = async (p, x, y0) => { await p.mouse.move(x, y0 + 6); await p.mouse.down(); await p.mouse.move(x, y0 + 80, { steps: 6 }); await p.mouse.up(); };
const vis = (p, n) => p.$eval(`[data-part="${n}"]`, (e) => !e.hidden);
const shot = async (p, name) => { if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${name}.png`, clip: await p.locator('[data-part="phone-body"]').boundingBox() }); } };

test("Android: a pointer pull opens the shade, the second expands it, Close returns focus", async () => {
  const b = await chromium.launch();
  try {
    const { p, box } = await open(b, "android");
    await p.focus("iframe");
    await pull(p, box.x + box.width / 2, box.y);
    assert.equal(await vis(p, "notification-shade"), true);
    assert.equal(await p.locator(".sf-tile").count(), 4); await shot(p, "android-shade-first");
    await pull(p, box.x + box.width / 2, box.y);
    assert.equal(await p.locator(".sf-tile").count(), 8); await shot(p, "android-shade-expanded");
    assert.equal(await p.evaluate(() => document.activeElement.dataset.part), "notification-shade");
    await p.click('[data-part="notification-shade"] [data-part="close"]');
    assert.equal(await vis(p, "notification-shade"), false);
    assert.equal(await p.evaluate(() => document.activeElement.tagName), "IFRAME");
  } finally { await b.close(); }
});

test("a swipe-dismiss does not also open the notification", async () => {
  const b = await chromium.launch();
  try {
    const { p, box } = await open(b, "android");
    await pull(p, box.x + box.width / 2, box.y);
    const n = await p.locator('[data-note="n1"]').boundingBox();
    await p.mouse.move(n.x + 20, n.y + n.height / 2); await p.mouse.down(); await p.mouse.move(n.x + 200, n.y + n.height / 2, { steps: 6 }); await p.mouse.up();
    assert.equal(await p.locator('[data-note="n1"]').count(), 0);
    assert.deepEqual(await p.evaluate(() => document.getElementById("app").contentWindow.__opened), []);
    assert.equal(await vis(p, "notification-shade"), true);
  } finally { await b.close(); }
});

test("iPhone: top left pull is Notification Center, top right is Control Center", async () => {
  const b = await chromium.launch();
  try {
    const { p, box } = await open(b, "ios");
    await pull(p, box.x + 40, box.y);
    assert.equal(await vis(p, "notification-center"), true); await shot(p, "iphone-notification-center");
    await p.keyboard.press("Escape"); assert.equal(await vis(p, "notification-center"), false);
    await pull(p, box.x + box.width - 70, box.y);
    assert.equal(await vis(p, "control-center"), true); await shot(p, "iphone-control-center");
    await p.click('[data-part="control-center"] [data-part="close"]');
    assert.equal(await vis(p, "control-center"), false);
  } finally { await b.close(); }
});
