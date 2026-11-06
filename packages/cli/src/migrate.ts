// `shipvo migrate --plan`: read-only plan for switching an Expo app from EAS Update (expo-updates) to Shipvo.
// It reads package.json and the app config and prints steps. It writes nothing.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectProject } from "./adopt.js";
import { runJson, UsageError, type Done } from "./json-out.js";

export type Found = { kind: "dependency" | "plugin" | "config-key" | "package"; where: string; entry: string };
export type MigratePlan = { system: "expo-updates" | "codepush" | null; found: Found[]; steps: string[] };

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const DOC = "docs/migrate-from-eas-update.md";

/** Reads the app and builds the plan. Changes nothing. */
export function buildPlan(dir: string): MigratePlan {
  const p = detectProject(dir);
  const pkg = readJson(join(dir, "package.json"));
  const found: Found[] = [];
  for (const sec of ["dependencies", "devDependencies"]) {
    for (const n of ["expo-updates", "react-native-code-push", "@revopush/react-native-code-push"])
      if (pkg?.[sec]?.[n]) found.push({ kind: "dependency", where: `package.json ${sec}`, entry: `${n}@${pkg[sec][n]}` });
  }
  let configNote = false;
  if (p.configKind === "app.json") {
    const raw = readJson(join(dir, "app.json"));
    const expo = raw?.expo ?? raw;
    for (const pl of expo?.plugins ?? []) if ((Array.isArray(pl) ? pl[0] : pl) === "expo-updates") found.push({ kind: "plugin", where: "app.json plugins", entry: "expo-updates" });
    for (const k of ["updates", "runtimeVersion"]) if (expo && k in expo) found.push({ kind: "config-key", where: "app.json", entry: `${k}: ${JSON.stringify(expo[k])}` });
    for (const os of ["ios", "android"]) if (expo?.[os] && "runtimeVersion" in expo[os]) found.push({ kind: "config-key", where: "app.json", entry: `${os}.runtimeVersion: ${JSON.stringify(expo[os].runtimeVersion)}` });
  } else if (p.configFile) configNote = true;

  const system = p.expoUpdates ? "expo-updates" : p.codePush ? "codepush" : null;
  if (!system) return { system, found, steps: [] };
  const steps: string[] = [];
  if (system === "codepush") {
    steps.push(`Follow docs/migrate-from-codepush.md. This command only plans an EAS Update switch.`);
    return { system, found, steps };
  }
  steps.push("Commit your work. Installed apps keep using EAS Update until a new store build ships, so do not stop publishing to EAS yet.");
  if (configNote) steps.push(`Open ${p.configFile} and look for the same entries by hand: the expo-updates plugin and the updates and runtimeVersion keys. This plan cannot read a code config.`);
  steps.push("Remove expo-updates from package.json (" + p.packageManager + " remove expo-updates).");
  steps.push("Remove the expo-updates entry from plugins, and the updates and runtimeVersion keys, from the app config.");
  steps.push("Remove calls to the expo-updates API (for example Updates.checkForUpdateAsync) from your code.");
  steps.push("Run shipvo init. It adds @shipvo/runtime, the config plugin, a signing key, shipvo.json, the sim/publish/rollback scripts and a publish workflow. It never overwrites a file.");
  steps.push("Back up the signing seed (shipvo keys export). If you lose it, installed apps will not accept another update.");
  steps.push("Build and submit a new store build. Only this build uses Shipvo; older binaries keep using EAS Update.");
  steps.push("Run shipvo publish --dry-run, then shipvo publish for the first Shipvo release once the new build is on devices.");
  return { system, found, steps };
}

const buildPlanPm = (dir: string) => detectProject(dir).packageManager;

export async function migrate(argv: string[], dir = process.cwd()): Promise<number> {
  dir = resolve(dir);
  const json = argv.includes("--json");
  const run = async (): Promise<Done> => {
    if (!argv.includes("--plan")) throw new UsageError("shipvo migrate needs --plan. Slice 1 only reads your app and prints the steps; it changes no files.");
    const plan = buildPlan(dir);
    if (!plan.system) {
      if (!json) console.log("Nothing to migrate: this app has no expo-updates or CodePush.");
      return { code: "nothing_to_migrate", summary: "Nothing to migrate: no expo-updates or CodePush found.", data: plan, next: [{ command: "shipvo init", why: "Add Shipvo to this app." }] };
    }
    if (!json) {
      console.log(`Found ${plan.system === "expo-updates" ? "expo-updates (EAS Update)" : "CodePush"}:`);
      for (const f of plan.found) console.log(`  - ${f.where}: ${f.entry}`);
      console.log("\nSteps, in this order:");
      plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      console.log(`\nNo files were changed. Details: ${DOC}`);
    }
    return {
      code: "plan", summary: `${plan.found.length} entries found, ${plan.steps.length} steps. No files changed.`, data: plan,
      next: plan.system === "expo-updates"
        ? [{ command: `${buildPlanPm(dir)} remove expo-updates`, why: "Step 1 of the plan." }, { command: "shipvo init --dry-run", why: "Preview what init adds once expo-updates is gone." }]
        : [{ command: "cat docs/migrate-from-codepush.md", why: "Follow the CodePush guide." }],
    };
  };
  if (json) { await runJson(run, [{ command: "shipvo help", why: "See the commands and flags." }]); return Number(process.exitCode ?? 0); }
  try { await run(); return 0; } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return e instanceof UsageError ? 2 : 1; }
}
