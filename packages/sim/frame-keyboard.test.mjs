// The frame buttons work from the keyboard and cannot trap the user. Runs the real frame script in Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");

test("power button, lock screen, menu and power-off work by keyboard", async () => {
  const f = renderFrame({ skin: "android", screen: '<iframe id="app" srcdoc="<h1>Home</h1>"></iframe>' });
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 460, height: 960 } });
    await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app")}</script>`);
    const vis = (n) => p.$eval(`[data-part="${n}"]`, (e) => !e.hidden);
    await p.focus('[data-part="power-button"]'); await p.keyboard.press("Enter");
    assert.equal(await vis("lock-screen"), true);
    assert.equal(await p.evaluate(() => document.activeElement.dataset.part), "unlock-button");
    await p.keyboard.press("Enter"); assert.equal(await vis("lock-screen"), false);
    await p.focus('[data-part="power-button"]'); await p.keyboard.press("Shift+Enter");
    assert.equal(await vis("power-menu"), true);
    await p.keyboard.press("Escape"); assert.equal(await vis("power-menu"), false);
    await p.focus('[data-part="power-button"]'); await p.keyboard.press("Shift+Enter"); await p.click('[data-act="poweroff"]');
    assert.equal(await vis("off-screen"), true);
    await p.focus('[data-part="power-button"]'); await p.keyboard.press("Enter");
    assert.equal(await vis("off-screen"), false);
    await p.waitForTimeout(1300);
    const box = await p.locator('[data-part="power-button"]').boundingBox();
    await p.mouse.move(box.x + 2, box.y + 10); await p.mouse.down(); await p.mouse.move(box.x - 80, box.y - 80); await p.waitForTimeout(900); await p.mouse.up();
    assert.equal(await vis("power-menu"), false, "dragging off the button cancels the long press");
  } finally { await b.close(); }
});
