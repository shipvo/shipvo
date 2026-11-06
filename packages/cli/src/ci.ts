import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { args } from "./config.js";

export const WORKFLOW_PATH = join(".github", "workflows", "shipvo-build.yml");

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
  if (sub !== "init") { console.error("Usage: shipvo ci init --framework capacitor|--check [--dry-run] [--force]"); return 2; }
  const a = args(rest);
  if (a.check !== undefined && a.check !== "false") return initCheck(a, cwd);
  if (a.framework !== "capacitor") { console.error("shipvo ci init: --framework capacitor is the only framework with a template so far"); return 2; }
  const body = readFileSync(templatePath("capacitor"), "utf8");
  const target = resolve(cwd, WORKFLOW_PATH);
  if (a["dry-run"] !== undefined && a["dry-run"] !== "false") {
    console.log(`Would write ${WORKFLOW_PATH}${existsSync(target) ? " (file exists; --force needed)" : ""}. Nothing was written.\n`);
    console.log(body);
    return 0;
  }
  if (existsSync(target) && (a.force === undefined || a.force === "false")) {
    console.error(`${WORKFLOW_PATH} already exists. Use --force to overwrite it.`);
    return 1;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  console.log(`Wrote ${WORKFLOW_PATH}. Add the secrets listed in docs/capacitor.md, then run the "Shipvo build" workflow.`);
  return 0;
}

export const CHECK_WORKFLOW_PATH = join(".github", "workflows", "shipvo-check.yml");

/** `shipvo ci init --check`: copy the pull request check workflow into the app's repo. */
function initCheck(a: Record<string, string | undefined>, cwd: string): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const rel = join("templates", "github-action", "shipvo-check.yml");
  const src = [join(here, rel), join(here, "..", "..", "..", rel)].find((c) => existsSync(c));
  if (!src) throw new Error("template for the Shipvo check not found");
  const body = readFileSync(src, "utf8"); const target = resolve(cwd, CHECK_WORKFLOW_PATH);
  if (a["dry-run"] !== undefined && a["dry-run"] !== "false") { console.log(`Would write ${CHECK_WORKFLOW_PATH}. Nothing was written.\n`); console.log(body); return 0; }
  if (existsSync(target) && (a.force === undefined || a.force === "false")) { console.error(`${CHECK_WORKFLOW_PATH} already exists. Use --force to overwrite it.`); return 1; }
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, body);
  console.log(`Wrote ${CHECK_WORKFLOW_PATH}. Commit it and open a pull request.`);
  return 0;
}
