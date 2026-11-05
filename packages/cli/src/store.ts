import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy, routeStore } from "@shipvo/store";
import type { RouteAnswers, StoreRoute } from "@shipvo/store";
import { args, loadConfig } from "./config.js";

/** `shipvo store details --dry-run [--out dir]`: print the answers, write two files. Nothing is uploaded; no credentials are read. */
export async function store(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "setup") return setup(rest);
  if (sub === "status") return status(rest);
  if (sub !== "details") { console.error("Usage: shipvo store details --dry-run [--out dir] | store setup | store status"); process.exit(2); }
  const a = args(rest);
  if (a["dry-run"] === undefined || a["dry-run"] === "false") { console.error("shipvo store details: upload is not available yet; use --dry-run"); process.exit(2); }
  const cfg = loadConfig();
  const d = deriveStoreDetails(cfg);
  const out = a.out && a.out !== "true" ? a.out : ".shipvo/store";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "data-safety.csv"), renderDataSafetyCsv(d));
  writeFileSync(join(out, "privacy-policy.md"), renderPrivacyPolicy(d));
  console.log(`Data safety answers for ${d.appName} (derived from shipvo.json):`);
  if (d.rows.length === 0) console.log("  No declared capability touches user data.");
  for (const r of d.rows) console.log(`  ${r.dataType}: collected ${r.collected}, shared ${r.shared}, purpose ${r.purpose}`);
  if (d.fill.total > 0) console.log(`Filled without you: ${d.fill.filled} of ${d.fill.total} fields.`);
  console.log(`\nYou still need to answer (${d.unknown.length}):`);
  for (const u of d.unknown) console.log(`  - ${u.question}`);
  console.log(`\nWrote ${join(out, "data-safety.csv")} and ${join(out, "privacy-policy.md")}. Nothing was uploaded.`);
}

const PLAN_FILE = "store-plan.json";
type Mark = "waiting" | "done";
interface Plan { version: 1; answers: RouteAnswers; marks: Record<string, Mark> }

function fail(msg: string): never { console.error(msg); process.exit(2); }

function yesNo(flag: string, v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (["yes", "true"].includes(v)) return true;
  if (["no", "false"].includes(v)) return false;
  return fail(`shipvo store setup: --${flag} must be yes or no, not "${v}".`);
}

async function ask(rl: ReturnType<typeof createInterface>, q: string, def: boolean): Promise<boolean> {
  const r = (await rl.question(`${q} [${def ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
  return r === "" ? def : r.startsWith("y");
}

function describe(title: string, r: StoreRoute, marks: Record<string, Mark>, withStatus: boolean): void {
  console.log(`${title}: ${r.account} account. ${r.accountNote}`);
  let next: typeof r.steps[number] | undefined;
  for (const s of r.steps) {
    const m = marks[s.id] ?? "todo";
    if (!next && m !== "done") next = s;
    console.log(`  ${withStatus ? `[${m}] ` : "- "}${s.id}: ${s.title}${s.wait ? ` (wait: ${s.wait})` : ""}`);
  }
  if (!withStatus) return;
  if (!next) console.log("  Done: this store is live.");
  else if ((marks[next.id] ?? "todo") === "waiting") console.log(`  Next: wait. ${next.wait ?? next.title}. Then run \`shipvo store status --mark ${next.id}\`.`);
  else console.log(`  Next: ${next.action} Then run \`shipvo store status --mark ${next.id}\`.`);
}

function printPlan(plan: Plan, withStatus: boolean): void {
  const r = routeStore(plan.answers);
  describe("Google Play", r.play, plan.marks, withStatus);
  console.log("");
  describe("App Store", r.apple, plan.marks, withStatus);
  if (!withStatus) for (const n of r.notes) console.log(`\n${n}`);
}

/** `shipvo store setup [--company yes|no] [--android-now] [--play-account-before-2023-11-13]`: write store-plan.json. No store calls. */
async function setup(argv: string[]): Promise<void> {
  const a = args(argv);
  let company = yesNo("company", a.company);
  let androidNow = yesNo("android-now", a["android-now"]);
  let before = yesNo("play-account-before-2023-11-13", a["play-account-before-2023-11-13"]);
  if (company === undefined && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    company = await ask(rl, "Do you have a registered company?", false);
    if (!company) {
      androidNow ??= await ask(rl, "Do you need Android live right now?", false);
      before ??= await ask(rl, "Did you make a Google Play developer account before 13 Nov 2023?", false);
    }
    rl.close();
  }
  const answers: RouteAnswers = { company: company ?? false, androidNow: androidNow ?? false, playAccountBefore20231113: before ?? false };
  const plan: Plan = { version: 1, answers, marks: {} };
  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n");
  console.log("Your store plan:\n");
  printPlan(plan, false);
  console.log(`\nWrote ${PLAN_FILE}. Run \`shipvo store status\` to see what to do next. Nothing was uploaded.`);
}

/** `shipvo store status [--mark <step> [--as waiting|done]]`: one timeline per store. */
async function status(argv: string[]): Promise<void> {
  if (!existsSync(PLAN_FILE)) fail(`No ${PLAN_FILE} here. Run \`shipvo store setup\` first.`);
  const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Plan;
  const a = args(argv);
  if (a.mark !== undefined) {
    const r = routeStore(plan.answers);
    const ids = [...r.play.steps, ...r.apple.steps].map((s) => s.id);
    if (!ids.includes(a.mark)) fail(`Unknown step "${a.mark}". Steps: ${ids.join(", ")}.`);
    const as = a.as ?? "done";
    if (as !== "waiting" && as !== "done") fail(`--as must be waiting or done, not "${as}".`);
    plan.marks[a.mark] = as;
    writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n");
    console.log(`Marked ${a.mark} as ${as}.\n`);
  }
  printPlan(plan, true);
}
