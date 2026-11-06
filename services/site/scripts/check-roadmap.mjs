// Issue #528. /roadmap/ is built from docs/ROADMAP.md: Now and Shipped items appear, issue links are right,
// footer, changelog, llms.txt and sitemap link it, and (with Chromium) nothing overflows and tap targets are 44 px.
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRoadmap, renderRoadmap, countTasks, fetchProgress } from "../roadmap.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const fails = [];
const check = (ok, m) => { if (!ok) fails.push(m); };

const md = readFileSync(join(site, "../../docs/ROADMAP.md"), "utf8");
const data = parseRoadmap(md);
check(data.goal.length > 0, "Goal missing");
check(data.now.flatMap((g) => g.items).length >= 5, "Now items missing");
check(data.shipped.length >= 10, "Shipped items missing");
check(data.notDoing.length >= 1, "Not doing items missing");
check(data.shipped.every((s, i, a) => !i || a[i - 1].date >= s.date), "Shipped not newest first");

// Fixture: issue links, PR links, progress bars, docs links.
const fx = parseRoadmap(`## Goal\n\nA goal.\n\n## Now\n\n**Group one:**\n- Epic A does things (#12)\n- No link epic\n\n## Shipped\n\n- 2026-01-01: Old thing ([Guide](cli.md), #5, #6)\n- 2026-02-01: New thing\n\n## Not doing (for now)\n\n- Nothing else.\n`);
check(fx.now[0].items[0].issue === 12 && fx.now[0].items[1].issue === null, "issue number parsing");
check(fx.shipped[0].text === "New thing" && fx.shipped[1].prs.join() === "5,6" && fx.shipped[1].doc.href === "cli.md", "shipped parsing");
const html = renderRoadmap(fx, { resolveHref: (h) => "/docs/" + h.replace(/\.md$/, "/"), progress: { 12: { done: 1, total: 4 } } });
check(html.includes('href="https://github.com/shipvo/shipvo/issues/12"'), "epic link");
check(html.includes('href="https://github.com/shipvo/shipvo/pull/6"'), "PR link");
check(html.includes('href="/docs/cli/"'), "docs link");
check(html.includes("1 of 4 slices done") && html.includes("width:25%"), "progress bar");
check(!renderRoadmap(fx).includes("rm-prog"), "no bar without progress");
check(JSON.stringify(countTasks("- [x] a\n- [ ] b\n  - [X] c")) === '{"done":2,"total":3}' && countTasks("none") === null, "countTasks");
check(Object.keys(await fetchProgress([1], { fetchFn: async () => { throw new Error("offline"); } })).length === 0, "offline fallback");
check((await fetchProgress([7], { fetchFn: async () => ({ ok: true, json: async () => ({ body: "- [x] a\n- [ ] b" }) }) }))[7].total === 2, "fetchProgress");

// Built output (needs the site build).
const out = join(site, "public/roadmap/index.html");
if (!existsSync(out)) { console.error("check-roadmap: run the site build first"); process.exit(1); }
const page = readFileSync(out, "utf8");
const first = data.now[0].items[0];
check(page.includes(`issues/${first.issue}`), "built page links first Now epic");
check(page.includes(data.shipped[0].date) , "built page has newest shipped date");
check(page.includes('href="/roadmap/"'), "footer links Roadmap");
check(readFileSync(join(site, "public/changelog/index.html"), "utf8").includes('href="/roadmap/"'), "changelog links roadmap");
check(readFileSync(join(site, "public/llms.txt"), "utf8").includes("/roadmap/"), "llms.txt lists roadmap");
check(readFileSync(join(site, "public/sitemap-static.txt"), "utf8").includes("/roadmap/\t"), "sitemap lists roadmap");

let chromium;
try { ({ chromium } = await import("playwright")); } catch { console.log("check-roadmap: playwright missing, browser checks skipped"); }
if (chromium) {
  const pub = join(site, "public");
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
  const server = createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    const f = [join(pub, p), join(pub, p, "index.html")].find((c) => !p.includes("..") && existsSync(c) && !c.endsWith("/") && /\.\w+$/.test(c));
    if (!f) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", types[f.slice(f.lastIndexOf("."))] || "application/octet-stream"); res.end(readFileSync(f));
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  for (const [w, h] of [[360, 780], [390, 844], [1440, 900]]) for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 800, isMobile: w < 800 });
    const pg = await ctx.newPage();
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await pg.goto(base + "/roadmap/", { waitUntil: "load" });
    const r = await pg.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll(".rm a")].filter((a) => a.offsetParent && a.getBoundingClientRect().height < 43.5 && !a.closest("p:not(.rm-refs)")).map((a) => a.textContent.trim().slice(0, 30)),
    }));
    check(r.over <= 0, `${w}px ${scheme}: horizontal overflow ${r.over}px`);
    check(r.small.length === 0, `${w}px ${scheme}: tap targets under 44px: ${r.small.join(", ")}`);
    await ctx.close();
  }
  await browser.close(); server.close();
}
if (fails.length) { console.error("roadmap check failed:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("roadmap check ok");
