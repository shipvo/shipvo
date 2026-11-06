// Issue #737. Public text must not claim "100% parity" or "identical" without a link to parity-results
// in the same paragraph. Paragraphs are blocks split on blank lines (Markdown) or on HTML block tags.
// Limit: this matches "100% parity" and "identical" only; other word orders (such as a "parity 100%" chip) are not caught.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "../..");
const CLAIM = /100\s?%\s+(actionable\s+)?parity|\bidentical\b/i;
const LINK = /parity-results/;

export function findViolations(text, isHtml = false) {
  const blocks = isHtml ? text.split(/<\/?(?:p|li|article|div|tr|td|h\d|section)\b[^>]*>|\n\s*\n/i) : text.split(/\n\s*\n/);
  return blocks.filter((b) => CLAIM.test(b) && !LINK.test(b)).map((b) => b.trim().replace(/\s+/g, " ").slice(0, 120));
}

// Self-test.
const bad = findViolations("We have 100% parity.\n\nOther text.");
const ok = findViolations("100% actionable parity, see [results](parity-results.md).");
const bad2 = findViolations("<p>Screens are identical.</p><p><a href=\"/docs/parity-results/\">x</a></p>", true);
if (bad.length !== 1 || ok.length !== 0 || bad2.length !== 1) { console.error("check-claims self-test failed"); process.exit(1); }

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(md|html)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [join(root, "README.md"), ...["docs", "blog", "services/site/pages"].filter((d) => existsSync(join(root, d))).flatMap((d) => walk(join(root, d)))]
  .filter((f) => !/docs\/(product|fr)\//.test(f) && !f.endsWith("parity-results.md"));
const fails = [];
for (const f of files) {
  for (const v of findViolations(readFileSync(f, "utf8"), f.endsWith(".html"))) fails.push(`${relative(root, f)}: ${v}`);
}
const build = readFileSync(join(root, "services/site/build.mjs"), "utf8");
for (const v of findViolations(build)) fails.push(`services/site/build.mjs: ${v}`);
if (fails.length) { console.error("Parity claims without a parity-results link in the same paragraph:\n" + fails.join("\n")); process.exit(1); }
console.log(`check-claims ok (${files.length} files)`);
