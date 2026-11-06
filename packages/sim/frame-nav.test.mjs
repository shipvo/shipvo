// The phone frame's home, recents, kill, swipe and 3-button navigation in Chromium. The frame page owns the state and reports it with postMessage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
// The "app" records every visibilitychange and its load count, so the test can see what the app heard.
const APP = `<body><p id=s>x</p><button aria-label="Back" onclick="document.title='back-clicked'">Back</button><script>
var seen=[];
document.addEventListener('visibilitychange',function(){seen.push(document.visibilityState);parent.postMessage({t:'vis',seen:seen.slice()},'*')});
parent.postMessage({t:'load',state:document.visibilityState},'*');</script></body>`;

async function open(skin) {
  const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="${APP.replace(/"/g, "&quot;")}"></iframe>` });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 460, height: 960 } }); p.setDefaultTimeout(5000);
  await p.setContent(`<style>${f.css}</style>${f.html}<script>window.msgs=[];addEventListener("message",function(e){window.msgs.push(e.data)})</script><script>${statusClientScript("app", skin)}</script>`);
  await p.waitForFunction(() => window.msgs.some((m) => m.t === "load"));
  const vis = (n) => p.$eval(`[data-part="${n}"]`, (e) => !e.hidden);
  const where = () => p.$eval('[data-part="phone-body"]', (e) => e.getAttribute("data-where") ?? "app");
  const seen = () => p.evaluate(() => { const v = window.msgs.filter((m) => m.t === "vis"); return v.length ? v[v.length - 1].seen : []; });
  const click = (n) => p.locator(`[data-part="${n}"]`).click();
  return { b, p, vis, where, seen, click };
}

test("android: Home, app icon, Recents, Close; the app hears hidden and visible, kill reloads it", async () => {
  const t = await open("android");
  try {
    await t.p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
    await t.p.waitForFunction(() => document.querySelector('[data-part="phone-body"]').getAttribute("data-where") === "home");
    assert.equal(await t.vis("home-screen"), true);
    assert.deepEqual(await t.seen(), ["hidden"]);
    await t.click("app-icon");
    assert.equal(await t.where(), "app"); assert.equal(await t.vis("home-screen"), false);
    await t.p.waitForFunction(() => window.msgs.filter((m) => m.t === "vis").pop().seen.length === 2);
    assert.deepEqual(await t.seen(), ["hidden", "visible"]);
    // 3-button navigation, from the power menu toggle.
    await t.p.evaluate(() => document.querySelector('[data-part="nav-style-toggle"]').click());
    assert.equal(await t.vis("nav-buttons"), true);
    await t.click("nav-recents");
    assert.equal(await t.where(), "recents"); assert.equal(await t.vis("recents"), true);
    await t.click("recents-open");
    assert.equal(await t.where(), "app");
    await t.click("nav-home");
    assert.equal(await t.where(), "home");
    await t.click("app-icon");
    await t.click("nav-recents");
    const before = await t.p.evaluate(() => window.msgs.filter((m) => m.t === "load").length);
    await t.click("recents-close");
    assert.equal(await t.where(), "home", "kill ends on the home screen");
    await t.p.waitForFunction((n) => window.msgs.filter((m) => m.t === "load").length > n, before);
    const loads = await t.p.evaluate(() => window.msgs.filter((m) => m.t === "load"));
    assert.equal(loads.length, before + 1, "the app was reloaded once");
    assert.equal(loads.at(-1).state, "visible", "the fresh page starts visible; the frame then hides it");
    await t.p.waitForFunction(() => window.msgs.filter((m) => m.t === "vis").pop().seen.at(-1) === "hidden");
    // Escape in the switcher goes back to the app.
    await t.click("app-icon"); await t.click("nav-recents");
    await t.p.keyboard.press("Escape");
    assert.equal(await t.where(), "app");
  } finally { await t.b.close(); }
});

for (const skin of ["android", "ios"]) test(`${skin}: swipe up goes home, swipe up and hold opens the switcher, edge swipe is Back`, async () => {
  const t = await open(skin);
  try {
    const bar = await t.p.locator(".sf-bar").boundingBox();
    const x = bar.x + bar.width / 2;
    await t.p.mouse.move(x, bar.y + 8); await t.p.mouse.down(); await t.p.mouse.move(x, bar.y - 200, { steps: 6 }); await t.p.mouse.up();
    assert.equal(await t.where(), "home", "a quick swipe up on the bar goes home");
    await t.click("app-icon");
    await t.p.mouse.move(x, bar.y + 8); await t.p.mouse.down(); await t.p.mouse.move(x, bar.y - 200, { steps: 4 });
    await t.p.waitForTimeout(500); await t.p.mouse.up();
    assert.equal(await t.where(), "recents", "up and hold opens the switcher");
    await t.p.keyboard.press("Escape");
    // A swipe from the left edge is Back: the app's Back button is clicked.
    const e = await t.p.locator('[data-part="edge-swipe"]').boundingBox();
    await t.p.mouse.move(e.x + 5, e.y + 200); await t.p.mouse.down(); await t.p.mouse.move(e.x + 160, e.y + 205, { steps: 6 }); await t.p.mouse.up();
    const title = await t.p.evaluate(() => document.getElementById("app").contentDocument.title);
    assert.equal(title, "back-clicked");
  } finally { await t.b.close(); }
});

test("a state change in the frame is posted to the parent page", async () => {
  const f = renderFrame({ skin: "android", screen: '<iframe id="app" srcdoc="<p>x</p>"></iframe>' });
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 460, height: 960 } });
    await p.setContent(`<style>${f.css}</style>${f.html}<script>window.states=[];addEventListener("message",function(e){if(e.data&&e.data.type==="pn:nav-state")window.states.push(e.data.where)})</script><script>${statusClientScript("app", "android")}</script>`);
    await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "recents" }, "*"));
    await p.locator('[data-part="recents-open"]').click();
    await p.waitForFunction(() => window.states.length >= 2);
    assert.deepEqual(await p.evaluate(() => window.states), ["recents", "app"]);
  } finally { await b.close(); }
});
