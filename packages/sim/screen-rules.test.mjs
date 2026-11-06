import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

// Issue #589. iOS reads the "Order placed" screen's banner as one element, the label of the button. The snapshot
// YAML-quotes that line (its label holds ": "), and the inner lines used to stay as extra text.
test("filterTree groups a YAML-quoted control line into its label, as iOS does", () => {
  const sim = [
    '- generic "Order placed" [ref=e178]:',
    '    - heading "Order TT-1001 placed" [level=1] [ref=e180]',
    '    - generic [ref=e181]: 2 × Chrome Spoon 30 g',
    `- 'button "Notification: Order TT-1001 confirmed. Total 7 100 FCFA." [ref=e188]':`,
    '  - generic [ref=e189]: Order TT-1001 confirmed',
    '  - generic [ref=e190]: Total 7 100 FCFA.',
  ].join("\n");
  // Labels of the recorded iOS tree for the same screen (Appium source from a parity-ios run): one element per row, banner is one button.
  const ios = ["Order TT-1001 placed", "2 × Chrome Spoon 30 g", "Notification: Order TT-1001 confirmed. Total 7 100 FCFA."];
  const labels = filterTree(sim).split("\n").map((l) => /"([^"]+)"/.exec(l)?.[1] ?? /\]: (.+)$/.exec(l)?.[1]).filter((x) => x && x !== "Order placed");
  assert.deepEqual(labels, ios);
});
