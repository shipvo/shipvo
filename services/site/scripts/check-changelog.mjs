// /changelog/: one entry per date (same-date releases merged, stray "Unreleased" joins the release above),
// package pills, highlights from the roadmap, changes grouped by area, and the search box.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog, renderChangelog, areaOf, groupByArea } from "../changelog.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const fails = [];
const check = (ok, m) => { if (!ok) fails.push(m); };
const md = `# Changelog\n\n## 2026-11-07 (release)\n\n- **@shipvo/cli 0.1.7**: cli: long text\n\n### Changes\n\n- cli: a\n- Migration: none.\n\n## 2026-11-07 (release)\n\n- **@shipvo/sim 0.1.7**: x\n- sim: b\n\n## Unreleased\n\n- lumi: c\n\n## 2026-11-05\n\n- \`@shipvo/mcp\`: d\n`;
const r = parseChangelog(md);
check(r.length === 2 && r[0].date === "2026-11-07" && r[1].date === "2026-11-05", "one entry per date, newest first");
check(r[0].packages.map((p) => p.name + "@" + p.version).join() === "@shipvo/cli@0.1.7,@shipvo/sim@0.1.7", "packages merged");
check(r[0].changes.join("|") === "cli: a|sim: b|lumi: c", "changes merged, Migration: none dropped, Unreleased joined");
check(areaOf("`@shipvo/mcp`: d").area === "MCP" && areaOf("cli: a").text === "a" && areaOf("plain line").area === "More", "areas");
check(groupByArea(["sim: x", "cli: y", "z"]).map((g) => g[0]).join() === "Simulator,CLI,More", "area order");
const html = renderChangelog({ releases: r, pending: ["cli: next"], highlights: [{ date: "2026-11-07", text: "Big thing", doc: { label: "Guide", href: "x.md" }, prs: [] }], resolveHref: (h) => "/docs/" + h });
check(html.includes("Coming in the next release") && html.includes("Big thing") && html.includes('href="/docs/x.md"'), "next block and highlights");
check(html.includes('href="https://www.npmjs.com/package/@shipvo/cli/v/0.1.7"'), "npm link");
check(html.includes('data-filter="#cl-feed"') && html.includes('id="cl-feed"'), "search box");
const out = join(site, "public/changelog/index.html");
if (existsSync(out)) { const page = readFileSync(out, "utf8"); check(page.includes("/filter.js") && page.includes('href="/roadmap/"'), "built page loads search and links roadmap"); }
if (fails.length) { console.error("changelog check failed:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("changelog check ok");
