// Issue #737. Public text must not claim "100% parity" or "identical" without a link to parity-results
// in the same paragraph. Paragraphs are blocks split on blank lines (Markdown) or on HTML block tags.
// "100% parity" and "parity 100%" must say "actionable", even with a link. Limit: other word orders are not caught.
// docs/product and docs/fr are not scanned, so those two folders are a known hole.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "../..");
const CLAIM = /100\s?%\s+(actionable\s+)?parity|parity\s+100\s?%|\bidentical\b/i;
const UNSCOPED = /100\s?%\s+parity|parity\s+100\s?%/i;
const LINK = /parity-results/;

export function findViolations(text, isHtml = false) {
  const blocks = isHtml ? text.split(/<\/?(?:p|li|article|div|tr|td|h\d|section)\b[^>]*>|\n\s*\n/i) : text.split(/\n\s*\n/);
  return blocks.filter((b) => UNSCOPED.test(b) || (CLAIM.test(b) && !LINK.test(b))).map((b) => b.trim().replace(/\s+/g, " ").slice(0, 120));
}

// Self-test.
const bad = findViolations("We have 100% parity.\n\nOther text.");
const ok = findViolations("100% actionable parity, see [results](parity-results.md).");
const bad2 = findViolations("<p>Screens are identical.</p><p><a href=\"/docs/parity-results/\">x</a></p>", true);
const bad3 = findViolations("iOS parity 100% (see parity-results)");
if (bad3.length !== 1 || bad.length !== 1 || ok.length !== 0 || bad2.length !== 1) { console.error("check-claims self-test failed"); process.exit(1); }

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(md|html)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [join(root, "README.md"), ...["docs", "blog", "services/site/pages"].filter((d) => existsSync(join(root, d))).flatMap((d) => walk(join(root, d)))]
  // docs/product and docs/fr are excluded: planning notes and translations that are not the public claim surface.
  .filter((f) => !/docs\/(product|fr)\//.test(f) && !f.endsWith("parity-results.md"));
const fails = [];
for (const f of files) {
  for (const v of findViolations(readFileSync(f, "utf8"), f.endsWith(".html"))) fails.push(`${relative(root, f)}: ${v}`);
}
const build = readFileSync(join(root, "services/site/build.mjs"), "utf8");
for (const v of findViolations(build)) fails.push(`services/site/build.mjs: ${v}`);
if (fails.length) { console.error("Parity claims without a parity-results link in the same paragraph:\n" + fails.join("\n")); process.exit(1); }
console.log(`check-claims ok (${files.length} files)`);
