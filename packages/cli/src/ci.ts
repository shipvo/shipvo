import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { args } from "./config.js";
import { explore } from "./explore.js";
import { testCmd } from "./test.js";
import { commentCmd, renderComment, upsertComment } from "./ci-comment.js";
import type { TestReport } from "./report-md.js";
import { loadConfig } from "./config.js";
import { checkPublishPolicy } from "./policy.js";
import { spawnSync } from "node:child_process";
import { shotsCmd } from "./ci-shots.js";

export const WORKFLOW_PATH = join(".github", "workflows", "shipvo-build.yml");
export const CHECK_WORKFLOW_PATH = join(".github", "workflows", "shipvo-check.yml");

/** The Shipvo check workflow. A test asserts this equals `templates/github-action/shipvo-check.yml`. */
export const CHECK_WORKFLOW = `name: Shipvo check

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: shipvo/shipvo/actions/check@main
`;

type Run = (argv: string[]) => Promise<number>;

/** `shipvo ci check`: run `shipvo test`, then `shipvo explore` (so the report exists even when a flow fails).
 * Fails on a test regression or a crash. Exploration findings alone do not fail it. */
export async function check(runTest: Run = testCmd, runExplore: Run = explore, changedFrom?: string): Promise<number> {
  const t = await runTest(["--report", "shipvo-report.json"]);
  let e: number;
  try { e = await runExplore(["--sim", "http://localhost:4545", ...(changedFrom ? ["--changed-from", changedFrom] : [])]); }
  catch (err) { console.error(err instanceof Error ? err.message : String(err)); e = 1; }
  return t !== 0 ? t : e;
}


export type FixDeps = {
  runTest?: Run;
  /** Publishes to the given band and returns the release id. */
  publishBand?: (band: string) => Promise<number>;
  policy?: unknown;
  readReport?: () => TestReport | null;
  post?: (body: string) => Promise<void>;
};

const FIRST_BAND = "b0";

function defaultPublish(band: string): Promise<number> {
  const r = spawnSync(process.execPath, [process.argv[1]!, "publish", "--bands", band, "--json"], { encoding: "utf8" });
  let doc: { data?: { release?: number }; summary?: string } = {};
  try { doc = JSON.parse(r.stdout); } catch { /* handled below */ }
  if (r.status !== 0 || typeof doc.data?.release !== "number") return Promise.reject(new Error(doc.summary ?? `shipvo publish exited ${r.status}`));
  return Promise.resolve(doc.data.release);
}

/** `shipvo ci fix`: run the flows; if all pass, publish to the first band only (never wider) and post the release id.
 * Widening stays with release health and the release policy. Returns the exit code. */
export async function fixToFirstBand(d: FixDeps = {}): Promise<number> {
  const runTest = d.runTest ?? testCmd;
  const code = await runTest(["--report", "shipvo-report.json"]);
  let report: TestReport | null = null;
  try { report = (d.readReport ?? (() => JSON.parse(readFileSync("shipvo-report.json", "utf8")) as TestReport))(); } catch { /* no report */ }
  const failed = (report?.flows ?? []).filter((f) => f.status === "failed").map((f) => f.name ?? "unnamed flow");
  let skipped: string | undefined;
  if (failed.length) skipped = `${failed.length === 1 ? "This flow is" : "These flows are"} still failing: ${failed.join(", ")}.`;
  else if (code !== 0 || !report) skipped = "`shipvo test` did not pass.";
  let fix: { release: number; band: string } | { skipped: string } | undefined;
  let exit = 0;
  if (skipped) { fix = { skipped }; exit = 1; }
  else {
    const policy = "policy" in d ? d.policy : loadConfig().policy;
    const verdict = checkPublishPolicy(policy, [FIRST_BAND]);
    if (!verdict.ok) { fix = { skipped: `Policy rule ${verdict.rule} refused the first band: ${verdict.reason}` }; exit = 1; }
    else {
      try { fix = { release: await (d.publishBand ?? defaultPublish)(FIRST_BAND), band: FIRST_BAND }; }
      catch (e) { fix = { skipped: `Publish failed: ${e instanceof Error ? e.message : String(e)}` }; exit = 1; }
    }
  }
  const body = renderComment({ test: report, fix });
  const post = d.post ?? (async (b: string) => {
    const env = process.env, pr = Number(env.SHIPVO_PR);
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !pr) { console.log(b); return; }
    await upsertComment({ repo: env.GITHUB_REPOSITORY, pr, token: env.GITHUB_TOKEN, body: b });
  });
  try { await post(body); } catch (e) { console.error(`Not posted: ${e instanceof Error ? e.message : e}`); }
  console.log("release" in fix ? `Published release ${fix.release} to ${fix.band}.` : fix.skipped);
  return exit;
}

/** Find the template: next to the built CLI (npm), or in the repo's `templates/` (development). */
function templatePath(framework: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const rel = join("templates", framework, "github-actions", "build.yml");
  for (const c of [join(here, rel), join(here, "..", "..", "..", rel)]) if (existsSync(c)) return c;
  throw new Error(`template for ${framework} not found`);
}

/** `shipvo ci init --framework capacitor [--dry-run] [--force]`. Returns the exit code. */
export async function ci(argv: string[], cwd = process.cwd()): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "check") {
    const i = rest.indexOf("--changed-from");
    const v = i >= 0 ? rest[i + 1] : undefined;
    if (i >= 0 && (v === undefined || v.startsWith("-"))) { console.error("shipvo ci check: --changed-from needs a commit sha"); return 2; }
    return check(testCmd, explore, v);
  }
  if (sub === "fix") return fixToFirstBand();
  if (sub === "shots") return shotsCmd(rest);
  if (sub === "comment") return commentCmd(rest);
  if (sub !== "init") { console.error("Usage: shipvo ci init --check | --framework capacitor [--dry-run] [--force]\n       shipvo ci check\n       shipvo ci fix"); return 2; }
  const a = args(rest);
  const isCheck = a.check !== undefined && a.check !== "false";
  if (!isCheck && a.framework !== "capacitor") { console.error("shipvo ci init: --framework capacitor is the only framework with a template so far"); return 2; }
  const body = isCheck ? CHECK_WORKFLOW : readFileSync(templatePath("capacitor"), "utf8");
  const path = isCheck ? CHECK_WORKFLOW_PATH : WORKFLOW_PATH;
  const target = resolve(cwd, path);
  if (a["dry-run"] !== undefined && a["dry-run"] !== "false") {
    console.log(`Would write ${path}${existsSync(target) ? " (file exists; --force needed)" : ""}. Nothing was written.\n`);
    console.log(body);
    return 0;
  }
  if (existsSync(target) && (a.force === undefined || a.force === "false")) {
    console.error(`${path} already exists. Use --force to overwrite it.`);
    return 1;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  if (isCheck) { console.log(`Wrote ${path}. Commit it and open a pull request.`); return 0; }
  console.log(`Wrote ${WORKFLOW_PATH}. Add the secrets listed in docs/capacitor.md, then run the "Shipvo build" workflow.`);
  return 0;
}
