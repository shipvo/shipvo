// Slice 3 of #442: the device panel on the `shipvo run` page. A fixture app exposes a device like the simulated
// @shipvo/device (`__pnDevice` with `set` and `push`) and shows what it reads; the test clicks each control.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRunServer } from "../src/run";

const simDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../sim");
const require = createRequire(join(simDir, "package.json"));

const APP = `<!doctype html><html><head><meta charset="utf-8"><script>
var st={location:{latitude:0,longitude:0},files:[],biometrics:{enrolled:true,nextResult:"success"},payment:{nextResult:"approve"},networkProfile:"online"};
window.__pnDevice={set:function(p){for(var k in p)st[k]=(p[k]&&typeof p[k]==="object"&&!Array.isArray(p[k]))?Object.assign({},st[k],p[k]):p[k]},push:function(n){window.__pushed=n;return "id1"}};
window.__state=function(){return st};
</script></head><body><h1 id="ready">fixture</h1></body></html>`;

let browser: any;
beforeAll(async () => {
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

describe.each(["android", "ios"] as const)("run device panel (%s frame)", (platform) => {
  it("each control changes what the app sees and logs a simulated event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-panel-")); writeFileSync(join(dir, "index.html"), APP);
    const server = await startRunServer({ dir, platform, name: "Test" });
    const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
    try {
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const app = async () => { const f = page.frames().find((x: any) => x !== page.mainFrame()); await f.waitForSelector("#ready"); return f; };
      const f = await app();
      const st = () => f.evaluate(() => (window as any).__state());
      const click = (c: string) => page.click(`#dpanel [data-control="${c}"]`);
      expect(await page.isVisible("#dpanel .body")).toBe(true);

      await page.selectOption('[data-control="location-list"]', { label: "Paris" }); await click("location-set");
      expect((await st()).location).toMatchObject({ latitude: 48.8566, longitude: 2.3522 });
      await page.fill('[data-control="lat"]', "-33.5"); await page.fill('[data-control="lng"]', "151.2"); await click("coords-set");
      expect((await st()).location).toMatchObject({ latitude: -33.5, longitude: 151.2 });
      await page.fill('[data-control="lat"]', "99"); await click("coords-set");
      expect((await st()).location.latitude).toBe(-33.5);

      await click("camera-image");
      expect((await st()).files[0]).toMatchObject({ name: "test-photo.svg", mimeType: "image/svg+xml" });

      await click("bio-none"); expect((await st()).biometrics.enrolled).toBe(false);
      await click("bio-fail"); expect((await st()).biometrics).toMatchObject({ enrolled: true, nextResult: "fail" });
      await click("bio-success"); expect((await st()).biometrics.nextResult).toBe("success");

      await click("pay-cancel"); expect((await st()).payment.nextResult).toBe("cancel");
      await click("pay-decline"); expect((await st()).payment.nextResult).toBe("decline");
      await click("pay-approve"); expect((await st()).payment.nextResult).toBe("approve");

      for (const [c, p] of [["net-offline", "offline"], ["net-2g", "2g"], ["net-slow-4g", "slow-4g"], ["net-online", "online"]]) {
        await click(c); expect((await st()).networkProfile).toBe(p);
      }

      await page.fill('[data-control="push-title"]', "Hello"); await page.fill('[data-control="push-body"]', "World"); await click("push-send");
      expect(await f.evaluate(() => (window as any).__pushed)).toEqual({ title: "Hello", body: "World" });

      const items: string[] = await page.$$eval("#shipvo-log li[data-simulated=true]", (l: any[]) => l.map((e) => e.textContent));
      expect(items.length).toBe(14);
      expect(items.every((t) => t.endsWith("(simulated)"))).toBe(true);
      expect(items.some((t) => /location set to 48\.8566/.test(t))).toBe(true);
      expect(items.some((t) => /test notification sent/.test(t))).toBe(true);
    } finally { await page.close(); await server.close(); }
  }, 60_000);
});
