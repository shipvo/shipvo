#!/usr/bin/env node
// Joins the per-step JSON from one job into one init-to-applied timeline per platform.
//   node scripts/first-run/continuous.mjs --android-measure first-run.json --android-applied applied-ota.json \
//     [--ios-measure first-run.json --ios-apply apply-ios.json] [--commit <sha>] [--run-url <url>] [--json]
// Inputs: measure.mjs output (array of {step, ms, exit}), applied-ota.mjs output ({steps, totalMs}) for Android,
// apply-ios.mjs output ({publishMs, downloadMs, applyMs, healthyMs, totalMs}) for iOS.
// Each input carries a commit, a platform and a run URL. Give them per input with --<input>-commit, --<input>-platform,
// --<input>-run-url (input = android-measure, android-applied, ios-measure, ios-apply), for all inputs with --commit and
// --run-url, or inside the file as an object with a "meta" field. Missing commit and run URL fall back to GITHUB_SHA and
// GITHUB_SERVER_URL/GITHUB_REPOSITORY/GITHUB_RUN_ID. Inputs of one platform with different commits, or an input
// for the wrong platform, exit 1. Every row is a span; the total is the sum of the rows, in exact milliseconds.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INPUTS = {
  "android-measure": { platform: "android", script: "measure.mjs" },
  "android-applied": { platform: "android", script: "applied-ota.mjs" },
  "ios-measure": { platform: "ios", script: "measure.mjs" },
  "ios-apply": { platform: "ios", script: "apply-ios.mjs" },
};
const LABEL = { android: "Android", ios: "iOS" };

const fail = (msg) => { throw Object.assign(new Error(msg), { usage: false }); };

function metaFor(name, data, opt, env) {
  const own = data && !Array.isArray(data) && typeof data.meta === "object" && data.meta ? data.meta : {};
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  return {
    platform: opt(`--${name}-platform`) ?? own.platform ?? INPUTS[name].platform,
    commit: opt(`--${name}-commit`) ?? own.commit ?? opt("--commit") ?? env.GITHUB_SHA,
    runUrl: opt(`--${name}-run-url`) ?? own.runUrl ?? opt("--run-url") ?? runUrl,
  };
}

const stepMs = (rows, name, file) => {
  const r = Array.isArray(rows) ? rows.find((x) => x && x.step === name) : undefined;
  if (!r || !Number.isInteger(r.ms) || r.ms <= 0) fail(`${file}: no "${name}" step with a measured time`);
  if (r.exit !== 0) fail(`${file}: step "${name}" failed (exit ${r.exit})`);
  return r.ms;
};

/** inputs: {measure, other} each {data, file, meta}. Returns {platform, commit, rows, totalMs}. */
export function buildTimeline(platform, inputs) {
  const all = Object.entries(inputs);
  for (const [, i] of all) {
    const name = i.name;
    if (i.meta.platform !== platform) fail(`platform mismatch: ${name} is ${i.meta.platform}, expected ${platform}`);
    if (!i.meta.commit) fail(`${name}: no commit (pass --commit or --${name}-commit)`);
  }
  const commits = [...new Set(all.map(([, i]) => i.meta.commit))];
  if (commits.length > 1) fail(`commit mismatch: ${all.map(([, i]) => `${i.name}=${i.meta.commit}`).join(", ")}`);
  const m = inputs.measure;
  const src = (i, script) => ({ script, commit: i.meta.commit, runUrl: i.meta.runUrl ?? null });
  const rows = [
    { step: "init", ms: stepMs(m.data, "init", m.file), covers: "shipvo init", ...src(m, "measure.mjs") },
    { step: "install", ms: stepMs(m.data, "install", m.file), covers: "package install in the scaffolded app", ...src(m, "measure.mjs") },
  ];
  const o = inputs.other;
  if (platform === "android") {
    const d = o.data?.steps;
    rows.push(
      { step: "publish", ms: stepMs(d, "publish", o.file), covers: "shipvo publish of the second release", ...src(o, "applied-ota.mjs") },
      { step: "download, apply, healthy", ms: stepMs(d, "publish to healthy", o.file), covers: "publish done to current_release on the Android emulator", ...src(o, "applied-ota.mjs") },
    );
  } else {
    const d = o.data ?? {};
    for (const k of ["publishMs", "downloadMs", "applyMs", "healthyMs"]) if (!Number.isInteger(d[k]) || d[k] < 0) fail(`${o.file}: ${k} is missing or null`);
    const lead = d.healthyMs - d.downloadMs - d.applyMs;
    if (lead < 0) fail(`${o.file}: healthyMs is shorter than downloadMs + applyMs`);
    rows.push(
      { step: "publish", ms: d.publishMs, covers: "shipvo publish", ...src(o, "apply-ios.mjs") },
      { step: "download", ms: d.downloadMs, covers: "first request to last bundle request", ...src(o, "apply-ios.mjs") },
      { step: "apply", ms: d.applyMs, covers: "last byte to healthy", ...src(o, "apply-ios.mjs") },
      { step: "healthy", ms: lead, covers: "publish done to download start on the iOS Simulator", ...src(o, "apply-ios.mjs") },
    );
  }
  return { platform, commit: commits[0], rows, totalMs: rows.reduce((n, r) => n + r.ms, 0) };
}

export function format(t) {
  const w = Math.max(...t.rows.map((r) => r.step.length), 5);
  const lines = [`${LABEL[t.platform]} init to applied OTA (commit ${t.commit})`];
  t.rows.forEach((r, i) => lines.push(`${i + 1}. ${r.step.padEnd(w)}  ${String(r.ms).padStart(9)} ms  ${r.script}  ${r.commit.slice(0, 7)}  ${r.runUrl ?? "no run url"}  (${r.covers})`));
  lines.push(`   ${"total".padEnd(w)}  ${String(t.totalMs).padStart(9)} ms`);
  return lines.join("\n");
}

const HELP = `usage: node scripts/first-run/continuous.mjs --android-measure <first-run.json> --android-applied <applied-ota.json> [--commit <sha>] [--run-url <url>] [--json]
       node scripts/first-run/continuous.mjs --ios-measure <first-run.json> --ios-apply <apply-ios.json> [--commit <sha>] [--run-url <url>] [--json]
Either or both platforms. Exits 1 when inputs come from different commits or platforms.`;

export function main(argv, io = { out: console.log, err: console.error }, env = process.env) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--help") || argv.includes("-h")) { io.out(HELP); return 0; }
  try {
    const out = [];
    for (const platform of ["android", "ios"]) {
      const names = Object.keys(INPUTS).filter((n) => INPUTS[n].platform === platform);
      const given = names.filter((n) => opt(`--${n}`));
      if (!given.length) continue;
      if (given.length !== names.length) fail(`${platform} needs both --${names[0]} and --${names[1]}`);
      const load = (n) => {
        const file = opt(`--${n}`);
        let data; try { data = JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
        return { name: n, data, file, meta: metaFor(n, data, opt, env) };
      };
      out.push(buildTimeline(platform, { measure: load(names[0]), other: load(names[1]) }));
    }
    if (!out.length) { io.err(HELP); return 2; }
    io.out(argv.includes("--json") ? JSON.stringify(out, null, 2) : out.map(format).join("\n\n"));
    return 0;
  } catch (e) { io.err(String(e.message ?? e)); return 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
