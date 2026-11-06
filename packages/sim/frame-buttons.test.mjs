// Pointer behaviour of the phone buttons in Chromium: short press locks, long press opens the power menu, swipe up unlocks, volume follows the level.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");

for (const skin of ["android", "ios"]) test(`${skin}: press locks, long press opens menu, swipe unlocks, volume shows level`, async () => {
  const f = renderFrame({ skin, screen: '<iframe id="app" srcdoc="<h1>Home</h1>"></iframe>' });
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 460, height: 960 } });
    await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app")}</script>`);
    const vis = (n) => p.$eval(`[data-part="${n}"]`, (e) => !e.hidden);
    const power = p.locator('[data-part="power-button"]');
    await power.click();
    assert.equal(await vis("lock-screen"), true);
    const box = await p.locator('[data-part="lock-screen"]').boundingBox();
    const x = box.x + box.width / 2;
    await p.mouse.move(x, box.y + 600); await p.mouse.down(); await p.mouse.move(x, box.y + 300, { steps: 5 }); await p.mouse.up();
    assert.equal(await vis("lock-screen"), false, "swipe up unlocks");
    const pb = await power.boundingBox();
    await p.mouse.move(pb.x + 2, pb.y + 10); await p.mouse.down(); await p.waitForTimeout(900); await p.mouse.up();
    assert.equal(await vis("power-menu"), true, "long press opens the menu");
    assert.equal(await vis("lock-screen"), false, "long press does not lock");
    assert.match(await p.locator('[data-part="power-menu"]').innerText(), /Restart[\s\S]*Power off/);
    await p.keyboard.press("Escape");
    await p.locator('[data-part="volume-up-button"]').click();
    assert.equal(await vis("volume-overlay"), true);
    assert.equal(await p.locator('[data-part="volume-level"]').innerText(), "60");
    assert.equal(await p.$eval('[data-part="volume-bar"] b', (e) => e.style.width), "60%");
    await p.locator('[data-part="volume-down-button"]').click(); await p.locator('[data-part="volume-down-button"]').click();
    assert.equal(await p.locator('[data-part="volume-level"]').innerText(), "40");
    assert.equal(await p.$eval('[data-part="volume-bar"] b', (e) => e.style.width), "40%");
  } finally { await b.close(); }
});
