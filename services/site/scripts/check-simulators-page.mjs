// /products/simulators/ shows measured numbers. They must match the published benchmark, and Android and iOS must both be on the page.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const page = fileURLToPath(new URL("../public/products/simulators/index.html", import.meta.url));
const fails = [];
if (!existsSync(page)) { console.error("simulators page check failed: run the site build first"); process.exit(1); }
const html = readFileSync(page, "utf8");
const bench = JSON.parse(readFileSync(root + "docs/product/sim-bench/scale-2026-11-07.json", "utf8"));
const ok = bench.steps.filter((s) => !s.failed);
const top = Math.max(...ok.map((s) => s.open));
const fastest = Math.max(...ok.filter((s) => s.medianStartMs < 10000).map((s) => s.batchSeconds));

for (const [label, text] of [["simulators open", `<em>${top}</em> phones`], ["memory per simulator", `${bench.perSimulatorMb}<small`], ["batch start seconds", `${fastest}<small`]])
  if (!html.includes(text)) fails.push(`the page does not show the benchmark's ${label} (${text})`);
if (!html.includes(`"open":${top}`)) fails.push("the benchmark steps are not embedded in the page");
if (bench.steps.some((s) => s.answering && s.answering.split("/")[0] !== s.answering.split("/")[1] && !s.failed)) fails.push("a step in the benchmark has a session that did not answer");

const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ");
for (const need of ["Android", "iOS", "412 x 915", "393 x 852", "/docs/parity-results/", "scale-2026-11-07.md"]) if (!body.includes(need)) fails.push(`the page is missing "${need}"`);
if ((body.match(/Android/g) ?? []).length < 3 || (body.match(/iOS/g) ?? []).length < 3) fails.push("Android and iOS must both appear throughout, with equal weight");
for (const bad of [/\bnot yet\b/i, /\blimitations?\b/i, /\bcaveats?\b/i, /\bbasic\b/i, /\bearly\b/i]) if (bad.test(body)) fails.push(`public copy uses a banned word: ${bad}`);
// every larger-machine result committed under docs/product/sim-bench shows its measured count, linked to its write-up
const dir = root + "docs/product/sim-bench/";
const sized = readdirSync(dir).filter((f) => /^scale-.*\d+cpu-.*\.json$/.test(f));
if (!sized.length) fails.push("no larger-machine result found in docs/product/sim-bench");
for (const f of sized) {
  const r = JSON.parse(readFileSync(dir + f, "utf8"));
  const n = Math.max(...r.steps.filter((s) => !s.failed).map((s) => s.open));
  const md = f.replace(/\.json$/, ".md");
  if (!existsSync(dir + md)) fails.push(`${md} is missing`);
  if (!html.includes(`data-to="${n}">${n}</b><span>simulators open at once on a ${r.machine.cpus}-CPU, ${r.machine.ramGb} GB`)) fails.push(`the page does not show ${n} simulators on ${r.machine.cpus} CPUs, ${r.machine.ramGb} GB (${f})`);
  if (!html.includes(`/docs/product/sim-bench/${md}`)) fails.push(`the page does not link ${md}`);
}
if (fails.length) { console.error("simulators page check failed:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("simulators page check ok");
