import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { args } from "./config.js";
import { explore } from "./explore.js";
import { testCmd } from "./test.js";
import { commentCmd } from "./ci-comment.js";
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
export async function check(runTest: Run = testCmd, runExplore: Run = explore, extra: string[] = []): Promise<number> {
  const t = await runTest(["--report", "shipvo-report.json"]);
  let e: number;
  try { e = await runExplore(["--sim", "http://localhost:4545", ...extra]); }
  catch (err) { console.error(err instanceof Error ? err.message : String(err)); e = 1; }
  return t !== 0 ? t : e;
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
    if (i >= 0 && !rest[i + 1]) { console.error("shipvo ci check: --changed-from needs a commit sha"); return 2; }
    return check(testCmd, explore, i >= 0 ? ["--changed-from", rest[i + 1]!] : []);
  }
  if (sub === "shots") return shotsCmd(rest);
  if (sub === "comment") return commentCmd(rest);
  if (sub !== "init") { console.error("Usage: shipvo ci init --check | --framework capacitor [--dry-run] [--force]\n       shipvo ci check"); return 2; }
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
