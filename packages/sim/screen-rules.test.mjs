import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { applyScreenRules, clearScreenRules, filterTree } from "./screen-rules.mjs";

test("filterTree drops empty generic lines", () => {
  const t = ["- generic [ref=e1]:", "- generic [ref=e2]", '- heading "Hi" [ref=e3]'].join("\n");
  assert.equal(filterTree(t), '- heading "Hi" [ref=e3]');
});

test("filterTree drops aria-hidden subtrees", () => {
  const t = ['- list [ref=e1]:', '  - listitem [aria-hidden] [ref=e2]:', '    - text: gone', '  - listitem [ref=e3]:', '    - text: kept'].join("\n");
  assert.equal(filterTree(t), ['- list [ref=e1]:', '  - listitem [ref=e3]:', '    - text: kept'].join("\n"));
});

test("filterTree hides inner text of labelled controls only", () => {
  const t = ['- button "Buy" [ref=e1]:', '  - text: Buy now', '- button [ref=e2]:', '  - text: Icon', '- text: after'].join("\n");
  assert.equal(filterTree(t), ['- button "Buy" [ref=e1]:', '- button [ref=e2]:', '  - text: Icon', '- text: after'].join("\n"));
});

let chromium;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch {}

test("DOM rules hide off-screen rail items and content behind a modal, and clear them", async (t) => {
  if (!chromium) return t.skip("playwright not installed");
  let browser;
  try { browser = await chromium.launch(); } catch { return t.skip("no browser"); }
  try {
    const page = await browser.newPage({ viewport: { width: 300, height: 400 } });
    await page.setContent(`<body><div id="rail" style="width:200px;overflow-x:auto"><div style="display:flex;width:1000px">
      <div id="a" style="width:100px">A</div><div id="b" style="width:100px">B</div><div id="c" style="width:100px">C</div></div></div>
      <div id="behind">Behind</div><div id="sheet" aria-modal="true">Sheet</div></body>`);
    const state = () => page.evaluate(() => Object.fromEntries(["a", "b", "c", "behind", "rail", "sheet"].map((id) => [id, document.getElementById(id).getAttribute("aria-hidden")])));
    await page.evaluate(`(${applyScreenRules})(document)`);
    const s = await state();
    assert.equal(s.a, null); assert.equal(s.b, null);
    assert.equal(s.c, "true");
    assert.equal(s.behind, "true"); assert.equal(s.rail, "true"); assert.equal(s.sheet, null);
    await page.evaluate(`(${clearScreenRules})(document)`);
    assert.deepEqual(Object.values(await state()), [null, null, null, null, null, null]);
  } finally { await browser.close(); }
});

// Issue #589. A control whose label holds ": " is YAML-quoted in the snapshot, and its inner lines used to stay as extra text.
const bannerHidden = (line, inner) => {
  const out = filterTree([line, `  - generic [ref=e9]: ${inner}`, '- button "After" [ref=e10]'].join("\n")).split("\n");
  return out.length === 2 && out[1] === '- button "After" [ref=e10]';
};

test("filterTree groups a YAML-quoted control line into its label (single-quoted, apostrophe, double-quoted)", () => {
  assert.ok(bannerHidden(`- 'button "Notification: Order TT-1001 confirmed." [ref=e8]':`, "Order TT-1001 confirmed"));
  assert.ok(bannerHidden(`- 'button "Notification: Don''t panic." [ref=e8]':`, "Don't panic"));
  assert.ok(bannerHidden(`- "button \\"Notice: say \\"hi\\"\\" [ref=e8]":`, "say hi"));
  assert.ok(bannerHidden(`- button "Plain" [ref=e8]:`, "inner"));
});

// The iOS side is a real recording: an excerpt of the Appium page source from parity-ios run 42015379557 (see the fixture header).
// That recording was taken after the banner had gone, so it has no banner; it pins the row labels the simulator must match.
test("filterTree keeps the Order placed rows as separate labels, as the recorded iOS tree has them", () => {
  const xml = readFileSync(new URL("./fixtures/ios-order-placed.xml", import.meta.url), "utf8");
  const ios = [...new Set([...xml.matchAll(/<XCUIElementTypeStaticText [^>]*label="([^"]*)"/g)].map((m) => m[1]))];
  assert.equal(ios.length, 4);
  const sim = [
    '- generic "Order placed" [ref=e178]:',
    '  - heading "Order TT-1003 placed" [level=1] [ref=e180]',
    '  - generic [ref=e181]: 1 × Surface Popper 9 cm',
    '  - generic [ref=e182]: Total 4 200 FCFA',
    '  - generic [ref=e183]: Shop pickup, Bonanjo · Mobile money 677000111, paid (SANDBOX-MW3GNY07)',
  ].join("\n");
  const labels = filterTree(sim).split("\n").map((l) => /heading "([^"]+)"/.exec(l)?.[1] ?? /\]: (.+)$/.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(labels, ios);
});
