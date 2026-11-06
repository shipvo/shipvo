// Lumi's first-run guide: three skippable steps, shown once, drawn only with Lumi and only when asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderFrame, statusClientScript } from "./frame.mjs";
import { GUIDE_STEPS } from "./guide.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const page = (f) => `<style>html,body{margin:0}${f.css}</style>${f.html}<script>${statusClientScript("app")}</script>`;

test("the guide has three short steps and is drawn only with lumi and guide", () => {
  assert.equal(GUIDE_STEPS.length, 3);
  assert.match(GUIDE_STEPS.map((s) => s.title).join("|").toLowerCase(), /home.*store.*assistant/);
  for (const skin of ["android", "ios"]) {
    assert.match(renderFrame({ skin, lumi: true, guide: true }).html, /data-part="lumi-guide"/);
    assert.doesNotMatch(renderFrame({ skin, lumi: true }).html, /lumi-guide/, "off unless asked for");
    assert.doesNotMatch(renderFrame({ skin, lumi: false, guide: true }).html, /guide/i, "no Lumi, no guide");
    assert.doesNotMatch(renderFrame({ skin, lumi: false, guide: true }).css, /guide/i);
  }
});

test("first launch shows the guide, Next steps through it, Done never shows it again", async () => {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 460, height: 960 } });
    await ctx.route("http://phone.test/**", (r) => r.fulfill({ contentType: "text/html", body: page(renderFrame({ skin: "android", lumi: true, guide: true })) }));
    const p = await ctx.newPage();
    await p.goto("http://phone.test/");
    const g = p.locator('[data-part="lumi-guide"]');
    assert.equal(await g.isVisible(), true);
    assert.equal(await p.locator('[data-part="guide-count"]').textContent(), "1 of 3");
    await p.click('[data-part="guide-next"]');
    assert.equal(await p.locator('[data-part="guide-count"]').textContent(), "2 of 3");
    await p.click('[data-part="guide-next"]');
    assert.equal(await p.locator('[data-part="guide-next"]').textContent(), "Done");
    await p.click('[data-part="guide-next"]');
    assert.equal(await g.isVisible(), false);
    assert.equal(await p.$eval('[data-part="lumi"]', (e) => e.dataset.state), "happy");
    await p.reload();
    assert.equal(await g.isVisible(), false, "does not come back");
    await p.close();
  } finally { await b.close(); }
});

test("Skip closes the guide at once and it never shows again", async () => {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 460, height: 960 } });
    await ctx.route("http://phone.test/**", (r) => r.fulfill({ contentType: "text/html", body: page(renderFrame({ skin: "ios", lumi: true, guide: true })) }));
    const p = await ctx.newPage();
    await p.goto("http://phone.test/");
    await p.click('[data-part="guide-skip"]');
    assert.equal(await p.locator('[data-part="lumi-guide"]').isVisible(), false);
    await p.reload();
    assert.equal(await p.locator('[data-part="lumi-guide"]').isVisible(), false);
  } finally { await b.close(); }
});

test("Escape skips the guide and it does not return after a reload", async () => {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 460, height: 960 } });
    await ctx.route("http://phone.test/**", (r) => r.fulfill({ contentType: "text/html", body: page(renderFrame({ skin: "android", lumi: true, guide: true })) }));
    const p = await ctx.newPage();
    await p.goto("http://phone.test/");
    const g = p.locator('[data-part="lumi-guide"]');
    assert.equal(await g.isVisible(), true);
    await p.keyboard.press("Escape");
    assert.equal(await g.isVisible(), false);
    await p.reload();
    assert.equal(await g.isVisible(), false);
  } finally { await b.close(); }
});

test("step 1 works on both skins: no home button is named, and it does not claim the home screen is showing", () => {
  assert.doesNotMatch(GUIDE_STEPS[0].text, /home button|This is the home screen/i);
  for (const skin of ["android", "ios"]) assert.match(renderFrame({ skin, lumi: true, guide: true }).html, /Go home to see your apps/);
});

test("step 3 wraps on a narrow phone and is not clipped, in light and dark", async () => {
  const b = await chromium.launch();
  try {
    for (const colorScheme of ["light", "dark"]) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 760 }, colorScheme });
      await ctx.route("http://phone.test/**", (r) => r.fulfill({ contentType: "text/html", body: page(renderFrame({ skin: "android", lumi: true, guide: true })) }));
      const p = await ctx.newPage();
      await p.goto("http://phone.test/");
      await p.click('[data-part="guide-next"]');
      await p.click('[data-part="guide-next"]');
      const r = await p.$eval(".sf-guide-step:not([hidden]) p", (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
      assert.ok(r.sw <= r.cw, `step 3 is clipped (${colorScheme})`);
      const fit = await p.$eval('[data-part="lumi-guide"]', (e) => { const a = e.getBoundingClientRect(), f = e.offsetParent.getBoundingClientRect(); return a.left >= f.left && a.right <= f.right; });
      assert.ok(fit, `guide stays inside the phone (${colorScheme})`);
      if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/guide-step3-360-${colorScheme}.png` });
      await ctx.close();
    }
  } finally { await b.close(); }
});
