// `shipvo migrate --plan`: read-only plan for switching an Expo app from EAS Update (expo-updates) to Shipvo.
// It reads package.json and the app config and prints steps. It writes nothing.
// `--apply` makes the safe edits (backups first). See applyEdits.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { detectProject } from "./adopt.js";
import { CliFailure, runJson, UsageError, type Done } from "./json-out.js";

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

const BACKUP = join(".shipvo", "migrate-backup");
const isPlugin = (pl: any) => (Array.isArray(pl) ? pl[0] : pl) === "expo-updates";
const indentOf = (raw: string) => (/^[ \t]+(?=")/m.exec(raw)?.[0] ?? "  ");

/** Edits one JSON file in memory. Returns the new text and what was removed, or null when nothing applies. */
function editJson(raw: string, edit: (o: any) => string[]): { text: string; removed: string[] } | null {
  const o = JSON.parse(raw);
  const removed = edit(o);
  return removed.length ? { text: JSON.stringify(o, null, indentOf(raw)) + (raw.endsWith("\n") ? "\n" : ""), removed } : null;
}

/** The safe edits: expo-updates dependency and plugin, and updates/runtimeVersion keys in app.json. */
export function applyEdits(dir: string): { file: string; removed: string[] }[] {
  const jobs: { file: string; edit: (o: any) => string[] }[] = [
    { file: "package.json", edit: (o) => {
      const r: string[] = [];
      for (const sec of ["dependencies", "devDependencies"]) if (o?.[sec]?.["expo-updates"]) { r.push(`package.json ${sec}: expo-updates`); delete o[sec]["expo-updates"]; }
      return r;
    } },
    { file: "app.json", edit: (o) => {
      const expo = o?.expo ?? o; const r: string[] = [];
      if (!expo || typeof expo !== "object") return r;
      if (Array.isArray(expo.plugins) && expo.plugins.some(isPlugin)) { expo.plugins = expo.plugins.filter((x: any) => !isPlugin(x)); r.push("app.json plugins: expo-updates"); }
      for (const k of ["updates", "runtimeVersion"]) if (k in expo) { delete expo[k]; r.push(`app.json: ${k}`); }
      for (const os of ["ios", "android"]) if (expo[os] && typeof expo[os] === "object" && "runtimeVersion" in expo[os]) { delete expo[os].runtimeVersion; r.push(`app.json: ${os}.runtimeVersion`); }
      return r;
    } },
  ];
  const pending: { file: string; text: string; removed: string[] }[] = [];
  for (const j of jobs) {
    const path = join(dir, j.file);
    if (!existsSync(path)) continue;
    let e; try { e = editJson(readFileSync(path, "utf8"), j.edit); } catch { continue; }
    if (e) pending.push({ file: j.file, ...e });
  }
  for (const f of pending) {
    const b = join(dir, BACKUP, f.file);
    mkdirSync(dirname(b), { recursive: true });
    copyFileSync(join(dir, f.file), b);
  }
  for (const f of pending) writeFileSync(join(dir, f.file), f.text);
  return pending.map((f) => ({ file: f.file, removed: f.removed }));
}

function dirtyFiles(dir: string): string[] {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  if (r.error || r.status !== 0) return [];
  return String(r.stdout).split("\n").filter(Boolean);
}

function applyEdits0(dir: string, force: boolean) {
  // Nothing to edit means nothing to refuse: a second run must exit 0 even though the backups are untracked.
  const probe = buildPlan(dir).found.some((f) => f.kind !== "dependency" || f.entry.startsWith("expo-updates@"));
  if (!probe) return [];
  if (!force) {
    const d = dirtyFiles(dir);
    if (d.length) throw new CliFailure(`Git tree is not clean (${d.length} changed path(s)). Commit or stash first, or pass --force.`, "dirty_tree", 1, [{ command: "git status", why: "See what changed." }, { command: "shipvo migrate --apply --force", why: "Apply anyway. Backups go in " + BACKUP + "." }]);
  }
  return applyEdits(dir);
}

const buildPlanPm = (dir: string) => detectProject(dir).packageManager;

export async function migrate(argv: string[], dir = process.cwd()): Promise<number> {
  dir = resolve(dir);
  const json = argv.includes("--json");
  const run = async (): Promise<Done> => {
    const apply = argv.includes("--apply");
    if (!apply && !argv.includes("--plan")) throw new UsageError("shipvo migrate needs --plan (print the steps) or --apply (make the safe edits).");
    if (apply && argv.includes("--plan")) throw new UsageError("Use --plan or --apply, not both.");
    const plan = buildPlan(dir);
    if (apply && plan.system === "expo-updates") {
      const edits = applyEdits0(dir, argv.includes("--force"));
      const pm = buildPlanPm(dir);
      if (!edits.length) {
        if (!json) console.log("Nothing left to do: no expo-updates entries remain in package.json or app.json.");
        return { code: "nothing_left", summary: "Nothing left to do: no expo-updates entries remain that --apply can edit.", data: { changed: [], backupDir: BACKUP }, next: [{ command: "shipvo init --dry-run", why: "Preview what init adds." }] };
      }
      const rest = plan.steps.filter((s) => !/^Remove (expo-updates from package|the expo-updates entry)/.test(s) && !/^Commit your work/.test(s));
      if (!json) {
        console.log("Changed:");
        for (const e of edits) for (const r of e.removed) console.log(`  - ${r}`);
        console.log(`\nBackups are in ${BACKUP}/.`);
        console.log("Old binaries keep using EAS Update until a new store build ships.");
        console.log("\nNext steps:");
        console.log(`  - Run ${pm} install to refresh the lockfile.`);
        rest.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
        console.log("\nI did not run shipvo init. Run it yourself when ready.");
      }
      return { code: "applied", summary: `Removed ${edits.reduce((n, e) => n + e.removed.length, 0)} entries from ${edits.length} file(s). Backups in ${BACKUP}.`, data: { changed: edits, backupDir: BACKUP, steps: rest }, next: [{ command: `${pm} install`, why: "Refresh the lockfile after removing expo-updates." }, { command: "shipvo init", why: "Add Shipvo. It is not run for you." }] };
    }
    if (apply && plan.system === "codepush") throw new UsageError("--apply only supports EAS Update. For CodePush see docs/migrate-from-codepush.md.");
    if (!plan.system) {
      if (!json) console.log(apply ? "Nothing left to do: this app has no expo-updates or CodePush." : "Nothing to migrate: this app has no expo-updates or CodePush.");
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
  try { await run(); return 0; } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return e instanceof CliFailure ? e.exit : 1; }
}
