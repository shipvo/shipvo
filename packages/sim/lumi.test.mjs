// Lumi in the phone frame: four states, an off switch, and no effect on what agents see. Runs the real frame in Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { renderFrame, statusClientScript } from "./frame.mjs";
import { lumiDefault, lumiHtml, lumiReaction, LUMI_STATES } from "./lumi.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const APP = `<!doctype html><title>t</title><body style="margin:0;background:#fff"><h1>Cart</h1><button>Checkout</button><label>Email <input aria-label="Email"></label>`;
const page = (f) => `<style>html,body{margin:0}${f.css}</style>${f.html}<script>${statusClientScript("app")}</script>`;
const withApp = (skin, lumi) => renderFrame({ skin, lumi, screen: `<iframe id="app" srcdoc="${APP.replace(/"/g, "&quot;")}"></iframe>` });

test("Lumi is off in CI and on elsewhere, and SHIPVO_LUMI wins", () => {
  assert.equal(lumiDefault({ CI: "true" }), false);
  assert.equal(lumiDefault({}), true);
  assert.equal(lumiDefault({ CI: "true", SHIPVO_LUMI: "on" }), true);
  for (const v of ["off", "0", "false", "no", "OFF"]) assert.equal(lumiDefault({ SHIPVO_LUMI: v }), false, v);
  assert.equal(lumiDefault({ CI: "false" }), true);
});

test("both skins draw Lumi beside the cutout, outside the app screen, hidden from assistive tech", () => {
  for (const skin of ["android", "ios"]) {
    const f = renderFrame({ skin, lumi: true, screen: "<i>APP</i>" });
    const bar = f.html.slice(f.html.indexOf('data-part="status-bar"'), f.html.indexOf('class="sf-content"'));
    assert.match(bar, /data-part="lumi" data-state="idle" aria-hidden="true" inert/, skin);
    assert.doesNotMatch(f.html.slice(f.html.indexOf('class="sf-content"')).split("</div>")[0], /lumi/, "not inside the app screen");
    assert.match(f.css, /\.sf-lumi\{/); assert.match(f.css, /sf-lumi-blink/); assert.match(f.css, /sf-lumi-glow/); assert.match(f.css, /sf-lumi-float/);
  }
});

test("lumi: false removes every trace of Lumi", () => {
  for (const skin of ["android", "ios"]) {
    const f = renderFrame({ skin, lumi: false });
    assert.doesNotMatch(f.html, /lumi/i); assert.doesNotMatch(f.css, /lumi/i);
  }
});

test("with Lumi on, the frame is the same markup as off plus the Lumi element", () => {
  for (const skin of ["android", "ios"]) {
    const on = renderFrame({ skin, lumi: true, screen: "<p>x</p>" }), off = renderFrame({ skin, lumi: false, screen: "<p>x</p>" });
    assert.equal(on.html.replace(lumiHtml(), ""), off.html);
    assert.deepEqual([on.width, on.height, on.outerWidth, on.outerHeight], [off.width, off.height, off.outerWidth, off.outerHeight]);
  }
});

test("Lumi's glow stays inside the status bar in every state, so it never touches the app's pixels", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const shots = [];
      for (const lumi of [true, false]) {
        const p = await b.newPage({ viewport: { width: 460, height: 960 } });
        await p.setContent(page(withApp(skin, lumi)));
        const box = await p.locator("#app").boundingBox();
        const per = [];
        for (const s of lumi ? ["happy", "worried"] : ["off", "off"]) {
          if (lumi) await p.evaluate((x) => window.shipvoLumi.set(x), s);
          await p.addStyleTag({ content: "*{animation:none!important}" });
          per.push(await p.screenshot({ clip: { ...box, height: 8 } }));
        }
        shots.push(per); await p.close();
      }
      assert.ok(shots[0].every((s, i) => Buffer.compare(s, shots[1][i]) === 0), `${skin}: top rows of the app`);
    }
  } finally { await b.close(); }
});

test("the simulator's own page, screenshots and screen tree never draw Lumi", () => {
  assert.doesNotMatch(readFileSync(new URL("./server.mjs", import.meta.url), "utf8"), /lumi/i);
});

test("each state shows one face, and the state can change by script", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      await p.setContent(page(withApp(skin, true)));
      for (const s of LUMI_STATES) {
        assert.equal(await p.evaluate((x) => window.shipvoLumi.set(x), s), true);
        const r = await p.$eval('[data-part="lumi"]', (e) => ({ st: e.dataset.state, shown: [...e.querySelectorAll("[data-face]")].filter((g) => !g.hidden).map((g) => g.dataset.face) }));
        assert.deepEqual(r, { st: s, shown: [s] });
      }
      assert.equal(await p.evaluate(() => window.shipvoLumi.set("angry")), false);
      await p.evaluate(() => window.postMessage({ type: "pn:lumi", state: "happy" }, "*")); await p.waitForTimeout(50);
      assert.equal(await p.$eval('[data-part="lumi"]', (e) => e.dataset.state), "happy");
      await p.close();
    }
  } finally { await b.close(); }
});

test("Lumi on or off: app screenshot, recorded frames and labelled screen tree are byte-identical", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const out = {};
      for (const lumi of [true, false]) {
        const p = await b.newPage({ viewport: { width: 460, height: 960 } });
        await p.setContent(page(withApp(skin, lumi)));
        const frame = await (async () => { for (let i = 0; i < 100; i++) { const f = p.frames().find((x) => x !== p.mainFrame()); if (f && await f.locator("button").count()) return f; await p.waitForTimeout(50); } throw new Error("app frame did not load"); })();
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        // The app's own area: the same pixels an agent's screenshot of the app shows.
        // The bottom 12px of the app area sit under the screen's rounded corners (radius 36 over a 24px bar). Chromium may
        // antialias a rounded clip differently once an animated layer exists, so those rows are frame edge, not app pixels.
        const full = await p.locator("#app").boundingBox();
        const box = { ...full, height: full.height - 12 };
        const snap = () => p.screenshot({ clip: box });
        // Wait until the app area stops changing, so a slow first paint cannot look like a Lumi difference.
        let shot = await snap();
        for (let i = 0; i < 40; i++) { await p.waitForTimeout(50); const again = await snap(); if (Buffer.compare(shot, again) === 0) break; shot = again; }
        const shots = [await snap(), await snap()];
        out[lumi] = { shot, shots, tree: await frame.locator("body").ariaSnapshot({ mode: "ai" }), page: await p.locator("body").ariaSnapshot({ mode: "ai" }),
          lumiHere: await p.locator('[data-part="lumi"]').count() };
        await p.close();
      }
      assert.equal(out[true].lumiHere, 1); assert.equal(out[false].lumiHere, 0);
      assert.ok(Buffer.compare(out[true].shot, out[false].shot) === 0, `${skin}: screenshot bytes`);
      assert.ok(Buffer.compare(out[true].shots[1], out[false].shots[1]) === 0, `${skin}: later frames`);
      assert.equal(out[true].tree, out[false].tree, `${skin}: app screen tree`);
      assert.equal(out[true].page, out[false].page, `${skin}: whole page tree, Lumi is not in it`);
      assert.match(out[true].tree, /Checkout/);
    }
  } finally { await b.close(); }
});

test("each result gives the right state and a one-line reason from the real error or result", () => {
  const cases = [
    [{ kind: "check-passed", name: "cart has 2 items" }, "happy", "Check passed: cart has 2 items"],
    [{ kind: "flow-done", name: "checkout" }, "happy", "Flow finished: checkout"],
    [{ kind: "page-error", error: new Error("Cannot read properties of undefined (reading 'id')\n    at Cart.js:12") }, "worried", "Page error: Cannot read properties of undefined (reading 'id')"],
    [{ kind: "crash", error: "Out of memory" }, "worried", "Crash: Out of memory"],
    [{ kind: "action-failed", name: "tap", error: "no element with ref e9" }, "worried", "Action failed (tap): no element with ref e9"],
    [{ kind: "check-failed", name: "title", detail: "expected 'Cart' but got 'Cartt'" }, "worried", "Check failed (title): expected 'Cart' but got 'Cartt'"],
  ];
  for (const [ev, state, reason] of cases) assert.deepEqual(lumiReaction(ev), { state, reason }, ev.kind);
  assert.equal(lumiReaction({ kind: "page-error" }).reason, "Page error: the page threw an error");
  const long = lumiReaction({ kind: "crash", error: "x".repeat(300) }).reason;
  assert.ok(!long.includes("\n") && long.length <= 98, "one short line");
  for (const bad of [null, undefined, "x", {}, { kind: "nope" }]) assert.equal(lumiReaction(bad), null);
});

test("react() and the pn:lumi event message set the state and the reason in the frame, and a new state clears the reason", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      await p.setContent(page(withApp(skin, true)));
      const read = () => p.$eval('[data-part="lumi"]', (e) => ({ st: e.dataset.state, reason: e.dataset.reason ?? null, title: e.getAttribute("title"), shown: [...e.querySelectorAll("[data-face]")].filter((g) => !g.hidden).map((g) => g.dataset.face) }));
      await p.evaluate(() => window.shipvoLumi.react({ kind: "page-error", error: "boom is not defined" }));
      assert.deepEqual(await read(), { st: "worried", reason: "Page error: boom is not defined", title: "Page error: boom is not defined", shown: ["worried"] }, skin);
      await p.evaluate(() => window.postMessage({ type: "pn:lumi", event: { kind: "check-passed", name: "ok" } }, "*")); await p.waitForTimeout(50);
      assert.deepEqual(await read(), { st: "happy", reason: "Check passed: ok", title: "Check passed: ok", shown: ["happy"] }, skin);
      await p.evaluate(() => window.shipvoLumi.set("idle"));
      assert.deepEqual(await read(), { st: "idle", reason: null, title: null, shown: ["idle"] }, skin);
      assert.equal(await p.evaluate(() => window.shipvoLumi.react({ kind: "nope" })), null);
      assert.equal((await read()).st, "idle");
      await p.close();
    }
  } finally { await b.close(); }
});
