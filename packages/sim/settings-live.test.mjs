// The Settings screen in the phone frame, driven with real clicks in Chromium. The app runs the real simulated device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderFrame, statusClientScript } from "./frame.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const shots = process.env.SETTINGS_SHOTS;
// The real device module, compiled to plain JS, loaded into the app iframe.
const ts = require("typescript");
const here = dirname(fileURLToPath(import.meta.url));
const devSrc = join(here, "..", "device", "src");
const js = (f) => ts.transpileModule(readFileSync(join(devSrc, f), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const dir = mkdtempSync(join(tmpdir(), "settings-live-"));
writeFileSync(join(dir, "system.js"), js("system.ts"));
writeFileSync(join(dir, "real.js"), "export const mayUseReal=()=>false,openStream=()=>{},levelMeter=()=>{},stopStream=()=>{},realPosition=()=>{},barcodeDetector=()=>{};");
writeFileSync(join(dir, "index.js"), js("index.web.ts").replace(/from "\.\/real"/, 'from "./real.js"').replace(/from "\.\/system"/, 'from "./system.js"').replace(/^import type .*$/m, "").replace(/^export \* from "\.\/types";$/m, ""));
const app = `<!doctype html><html><body><p id=t>Hello</p><script type=module>
import "./index.js";
window.seen=[];window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",e=>seen.push(e.matches));</script></body></html>`;
writeFileSync(join(dir, "app.html"), app);

async function open(b, skin) {
  const f = renderFrame({ skin, screen: `<iframe id="app" src="app.html"></iframe>` });
  const p = await b.newPage({ viewport: { width: 460, height: 960 } });
  await p.route("http://app.test/**", (r) => { const n = new URL(r.request().url()).pathname.slice(1) || "index.html"; r.fulfill({ body: readFileSync(join(dir, n)), contentType: n.endsWith(".js") ? "text/javascript" : "text/html" }); });
  await p.route("http://app.test/", (r) => r.fulfill({ contentType: "text/html", body: `<meta charset="utf-8"><base href="http://app.test/"><style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin)}</script>` }));
  await p.goto("http://app.test/");
  await p.waitForFunction(() => document.getElementById("app").contentWindow.__pnDevice);
  return p;
}
const app$ = (p, expr) => p.evaluate((e) => document.getElementById("app").contentWindow.eval(e), expr);
const shot = async (p, name) => { if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${name}.png`, clip: await p.locator('[data-part="phone-body"]').boundingBox() }); } };

for (const skin of ["android", "ios"]) {
  test(`${skin}: Settings from the home screen changes what the app sees`, async () => {
    const b = await chromium.launch();
    try {
      const p = await open(b, skin);
      await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
      await p.click('[data-part="settings-icon"]');
      assert.equal(await p.locator('[data-part="settings-screen"]').isVisible(), true);
      assert.equal(await p.locator('[data-part="settings-screen"] [role=switch]').count(), 4);
      assert.equal(await app$(p, 'matchMedia("(prefers-color-scheme: dark)").matches'), false);
      await p.click('[role=switch][data-setting="darkMode"]');
      assert.equal(await app$(p, 'matchMedia("(prefers-color-scheme: dark)").matches'), true);
      assert.deepEqual(await app$(p, "seen"), [true]);
      assert.equal(await p.getAttribute('[data-setting="darkMode"]', "aria-checked"), "true");
      await p.selectOption('select[data-setting="fontSize"]', "large");
      assert.equal(await app$(p, "devicePixelRatio"), 1.3); // headless base ratio is 1
      await p.click('[role=switch][data-setting="boldText"]'); await p.click('[role=switch][data-setting="reduceMotion"]');
      assert.equal(await app$(p, 'matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
      assert.equal(await app$(p, 'document.documentElement.hasAttribute("data-pn-bold-text")'), true);
      await p.selectOption('select[data-setting="language"]', "ar");
      assert.equal(await app$(p, 'document.documentElement.dir'), "rtl");
      assert.equal(await app$(p, 'navigator.language'), "ar");
      assert.equal(await p.getAttribute('[data-setting="rtl"]', "aria-checked"), "true");
      await shot(p, `${skin}-settings`);
      await p.click('[data-part="close-settings"]');
      assert.equal(await p.locator('[data-part="settings-screen"]').isVisible(), false);
    } finally { await b.close(); }
  });
}

test("the shade gear opens Settings and closes the shade", async () => {
  const b = await chromium.launch();
  try {
    const p = await open(b, "android");
    const box = await p.locator('[data-part="top-edge"]').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + 6); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2, box.y + 90, { steps: 6 }); await p.mouse.up();
    assert.equal(await p.locator('[data-part="notification-shade"]').isVisible(), true);
    await p.click('[data-part="notification-shade"] [data-part="settings-gear"]');
    assert.equal(await p.locator('[data-part="notification-shade"]').isVisible(), false);
    assert.equal(await p.locator('[data-part="settings-screen"]').isVisible(), true);
  } finally { await b.close(); }
});
