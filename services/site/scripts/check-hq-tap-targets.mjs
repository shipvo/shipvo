// Guards /hq phone controls: buttons, tabs, the brand link and summaries keep a 44 px
// minimum in the max-width:980px block, and the tab row scrolls inside its own container.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const html = readFileSync(new URL("../public/hq/index.html", import.meta.url), "utf8");
const fail = (m) => { console.error("hq tap targets check failed: " + m); process.exit(1); };
const start = html.indexOf("@media (max-width:980px){");
if (start === -1) fail("missing @media (max-width:980px) block");
const block = html.slice(start, html.indexOf("</style>", start));
for (const sel of [".btn,.btn.sm", "nav.tabs a", "header.top .brand", "summary", "select,input,textarea"]) {
  const i = block.indexOf(sel + "{");
  if (i === -1 || !/min-height:44px/.test(block.slice(i, block.indexOf("}", i)))) fail(`${sel} needs min-height:44px`);
}
if (!/nav\.tabs\{[^}]*overflow-x:auto/.test(html)) fail("nav.tabs must scroll inside itself (overflow-x:auto)");

// Measured in Chromium at 390 and 768: no control under 44 px, nothing wider than the viewport.
let chromium;
try { ({ chromium } = await import("playwright")); } catch { console.log("hq tap targets: playwright missing, browser checks skipped"); }
if (chromium) {
  const file = "file://" + fileURLToPath(new URL("../public/hq/index.html", import.meta.url));
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [768, 1024]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage();
    await pg.route(/^https?:\/\//, (r) => r.abort());
    await pg.goto(file, { waitUntil: "load" });
    const r = await pg.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll("button,.btn,nav.tabs a,header.top .brand,summary,select,input:not([type=hidden]),textarea")]
        .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => (e.className || e.tagName) + ":" + (e.textContent || "").trim().slice(0, 20)),
    }));
    if (r.over > 0) fail(`${w}px: horizontal overflow ${r.over}px`);
    if (r.small.length) fail(`${w}px: targets under 44px: ${r.small.join(", ")}`);
    await ctx.close();
  }
  await browser.close();
}
console.log("hq tap targets check ok");
