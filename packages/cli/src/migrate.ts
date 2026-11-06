// `shipvo migrate --plan`: read-only plan for switching an Expo app from EAS Update (expo-updates) to Shipvo.
// It reads package.json and the app config and prints steps. It writes nothing.
// `--apply` makes the safe edits (backups first). See applyEdits.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { detectProject } from "./adopt.js";
import { CliFailure, runJson, UsageError, type Done } from "./json-out.js";

export type Found = { kind: "dependency" | "plugin" | "config-key" | "package" | "wrapper" | "sync" | "deployment-key" | "public-key" | "command"; where: string; entry: string; file?: string; line?: number };
export type MigratePlan = { system: "expo-updates" | "codepush" | null; found: Found[]; steps: string[] };

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const DOC = "docs/migrate-from-eas-update.md";

const SKIP_DIRS = new Set(["node_modules", ".git", "Pods", "build", "dist", "dist-ota", "dist-web", ".shipvo", ".gradle", "DerivedData", ".expo"]);
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const CI_FILE = /(?:\.ya?ml|\.sh|Fastfile|Makefile)$/;

function walk(dir: string, rel = "", depth = 0, out: string[] = []): string[] {
  if (depth > 8 || out.length > 5000) return out;
  let names: string[]; try { names = readdirSync(join(dir, rel)).sort(); } catch { return out; }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    const r = rel ? `${rel}/${n}` : n;
    let st; try { st = statSync(join(dir, r)); } catch { continue; }
    if (st.isDirectory()) walk(dir, r, depth + 1, out);
    else if (st.size < 1_000_000) out.push(r);
  }
  return out;
}

/** Finds CodePush entries with file and line. Reads only. */
function scanCodePush(dir: string): Found[] {
  const found: Found[] = [];
  const add = (kind: Found["kind"], file: string, line: number, entry: string) => found.push({ kind, where: `${file}:${line}`, entry, file, line });
  for (const file of walk(dir)) {
    const base = file.split("/").pop()!;
    const isPkg = file === "package.json";
    const isCode = CODE_EXT.test(file);
    const isNative = base === "Info.plist" || base === "strings.xml";
    const isCi = CI_FILE.test(base) || base === ".gitlab-ci.yml";
    if (!isPkg && !isCode && !isNative && !isCi) continue;
    let lines: string[]; try { lines = readFileSync(join(dir, file), "utf8").split("\n"); } catch { continue; }
    lines.forEach((text, i) => {
      const n = i + 1; const t = text.trim();
      if (isPkg) {
        const d = /"((?:@revopush\/)?react-native-code-push)"\s*:\s*"([^"]*)"/.exec(text);
        if (d) add("dependency", file, n, `${d[1]}@${d[2]}`);
      }
      if (isCode && !isPkg) {
        if (/\bcodePush\s*\(/.test(text) && !/^\s*(\/\/|\*)/.test(text)) add("wrapper", file, n, t);
        else if (/\bCodePush\.(sync|checkForUpdate|getUpdateMetadata|notifyAppReady|restartApp|allowRestart|disallowRestart)\b/.test(text) && !/^\s*(\/\/|\*)/.test(text)) add("sync", file, n, t);
      }
      if (isNative) {
        if (/CodePushDeploymentKey/.test(text)) add("deployment-key", file, n, "CodePushDeploymentKey");
        if (/CodePushPublicKey/.test(text)) add("public-key", file, n, "CodePushPublicKey");
      }
      if ((isPkg || isCi) && /appcenter\s+codepush/.test(text)) add("command", file, n, t.replace(/^"[^"]*":\s*/, "").replace(/,$/, "").replace(/^"|"$/g, ""));
    });
  }
  return found;
}

function codePushSteps(found: Found[]): string[] {
  const has = (k: Found["kind"]) => found.filter((f) => f.kind === k);
  const at = (k: Found["kind"]) => [...new Set(has(k).map((f) => f.where))].join(", ");
  const steps = ["Commit your work. Installed apps keep using CodePush until a new store build ships."];
  if (has("wrapper").length || has("sync").length) steps.push(`Replace the codePush() wrapper and CodePush.sync calls (${[at("wrapper"), at("sync")].filter(Boolean).join(", ")}) with @shipvo/runtime: call Runtime.markHealthy() once the first screen renders and Runtime.checkForUpdate(true) to look for a release.`);
  if (has("deployment-key").length || has("public-key").length) steps.push(`Remove the native keys (${[at("deployment-key"), at("public-key")].filter(Boolean).join(", ")}). Shipvo pins one control plane URL and one public key in the app config, not a per-environment deployment key.`);
  steps.push("Remove react-native-code-push from package.json" + (has("dependency").length ? ` (${at("dependency")})` : "") + " and reinstall, so no build has two update mechanisms.");
  steps.push("Add @shipvo/runtime and @shipvo/device, and @shipvo/cli as a dev dependency.");
  steps.push("Create the Shipvo config: run shipvo init in a scratch folder and copy shipvo.json and the @shipvo/runtime plugin entry into your app config. Back up the signing seed (shipvo keys export); if you lose it, installed apps will not accept another update.");
  if (has("command").length) steps.push(`Replace the appcenter codepush commands (${at("command")}) with shipvo publish, and appcenter codepush rollback with shipvo rollback --to <release>. --rollout <n> has no direct equivalent: Shipvo releases to cohort bands (--bands b0,b1,b2), then shipvo promote widens a release.`);
  else steps.push("Publish with shipvo publish --bands b0, then shipvo promote. CodePush --rollout <n> has no direct equivalent: Shipvo uses cohort bands.");
  steps.push("Run shipvo doctor and shipvo publish --dry-run.");
  steps.push("Build and submit one new store build. Only this build uses Shipvo; older binaries keep using CodePush.");
  steps.push("Run shipvo publish for the first Shipvo release once the new build is on devices.");
  return steps;
}

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
    const cp = [...found.filter((f) => !/react-native-code-push/.test(f.entry)), ...scanCodePush(dir)];
    return { system, found: cp, steps: codePushSteps(cp) };
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

type CpEdit = { file: string; removed: string[] };
const CP_PKG = ["react-native-code-push", "@revopush/react-native-code-push"];
const CP_IMPORT = /^import\s[^;]*?\bfrom\s*['"](?:@revopush\/)?react-native-code-push['"];?[ \t]*$/;
const CP_ARGS = String.raw`\((?:[^()]|\([^()]*\))*\)`;
const CP_WRAP = new RegExp(String.raw`\bcodePush\s*${CP_ARGS}\s*\(\s*(\w+)\s*\)`);
const CP_SYNC = new RegExp(String.raw`\bCodePush\.sync\s*${CP_ARGS}`);
const CP_READY = /\bCodePush\.notifyAppReady\s*\(\s*\)/;
const isComment = (l: string) => /^\s*(\/\/|\*)/.test(l);

/** Rewrites one code file. Single-line patterns only; anything else is left for the manual list. */
function editCode(raw: string): { text: string; removed: string[] } | null {
  if (!/react-native-code-push|\bcodePush\b|\bCodePush\b/.test(raw)) return null;
  const removed: string[] = [];
  const lines = raw.split("\n");
  const imports: number[] = [];
  const out = lines.map((l, i) => {
    if (isComment(l)) return l;
    if (CP_IMPORT.test(l.trim())) { imports.push(i); return l; }
    let r = l;
    if (CP_WRAP.test(r)) { r = r.replace(CP_WRAP, "$1"); removed.push(`${i + 1}: codePush() wrapper`); }
    if (CP_SYNC.test(r)) { r = r.replace(CP_SYNC, "Runtime.checkForUpdate(true)"); removed.push(`${i + 1}: CodePush.sync`); }
    if (CP_READY.test(r)) { r = r.replace(CP_READY, "Runtime.markHealthy()"); removed.push(`${i + 1}: CodePush.notifyAppReady`); }
    return r;
  });
  if (!removed.length) return null;
  const usesRuntime = out.some((l) => /\bRuntime\./.test(l));
  const hasRuntime = /import[^;]*\bRuntime\b[^;]*from\s*['"]@shipvo\/runtime['"]/.test(out.join("\n"));
  const stillCp = out.some((l, i) => !imports.includes(i) && !isComment(l) && /\b(?:codePush|CodePush)\b/.test(l));
  if (imports.length && !stillCp) {
    const first = imports[0];
    for (const i of imports.slice().reverse()) {
      if (i === first && usesRuntime && !hasRuntime) out[i] = 'import { Runtime } from "@shipvo/runtime";';
      else out.splice(i, 1);
    }
    removed.push("import react-native-code-push");
  } else if (usesRuntime && !hasRuntime) {
    out.splice(imports.length ? imports[0] + 1 : 0, 0, 'import { Runtime } from "@shipvo/runtime";');
  }
  return { text: out.join("\n"), removed };
}

function editNative(raw: string, base: string): { text: string; removed: string[] } | null {
  const removed: string[] = [];
  let text = raw;
  for (const key of ["CodePushDeploymentKey", "CodePushPublicKey"]) {
    const re = base === "Info.plist"
      ? new RegExp(String.raw`[ \t]*<key>${key}</key>[ \t]*\r?\n[ \t]*<string>[^<]*</string>[ \t]*\r?\n?`)
      : new RegExp(String.raw`[ \t]*<string\s+name="${key}"[^>]*>[^<]*</string>[ \t]*\r?\n?`);
    if (re.test(text)) { text = text.replace(re, ""); removed.push(key); }
  }
  return removed.length ? { text, removed } : null;
}

/** CodePush --apply: wrapper and sync calls, native keys, and the dependency. Never runs a package manager. */
export function applyCodePushEdits(dir: string, dry = false): CpEdit[] {
  const pending: { file: string; text: string; removed: string[] }[] = [];
  for (const file of walk(dir)) {
    const base = file.split("/").pop()!;
    const native = base === "Info.plist" || base === "strings.xml";
    if (file === "package.json" || (!native && !CODE_EXT.test(file))) continue;
    let raw: string; try { raw = readFileSync(join(dir, file), "utf8"); } catch { continue; }
    const e = native ? editNative(raw, base) : editCode(raw);
    if (e) pending.push({ file, text: e.text, removed: e.removed.map((r) => `${file} ${r}`) });
  }
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    const raw = readFileSync(pkgPath, "utf8");
    let e: { text: string; removed: string[] } | null = null;
    try {
      e = editJson(raw, (o) => {
        const r: string[] = [];
        for (const sec of ["dependencies", "devDependencies"]) for (const n of CP_PKG) if (o?.[sec]?.[n]) { delete o[sec][n]; r.push(`package.json ${sec}: ${n}`); }
        if (!r.length) return r;
        o.dependencies = { ...(o.dependencies ?? {}) };
        o.devDependencies = { ...(o.devDependencies ?? {}) };
        for (const n of ["@shipvo/runtime", "@shipvo/device"]) if (!o.dependencies[n]) { o.dependencies[n] = "^0.1.0"; r.push(`package.json dependencies: added ${n}`); }
        if (!o.devDependencies["@shipvo/cli"]) { o.devDependencies["@shipvo/cli"] = "^0.1.0"; r.push("package.json devDependencies: added @shipvo/cli"); }
        for (const sec of ["dependencies", "devDependencies"]) {
          o[sec] = Object.fromEntries(Object.entries(o[sec]).sort(([a], [b]) => a.localeCompare(b)));
          if (!Object.keys(o[sec]).length) delete o[sec];
        }
        return r;
      });
    } catch { /* unreadable package.json: leave it */ }
    if (e) pending.push({ file: "package.json", ...e });
  }
  if (!dry) {
    for (const f of pending) {
      const b = join(dir, BACKUP, f.file);
      mkdirSync(dirname(b), { recursive: true });
      copyFileSync(join(dir, f.file), b);
    }
    for (const f of pending) writeFileSync(join(dir, f.file), f.text);
  }
  return pending.map((f) => ({ file: f.file, removed: f.removed }));
}

function applyCodePush(dir: string, force: boolean): CpEdit[] {
  // Same rule as the EAS path: nothing to edit means nothing to refuse.
  if (!applyCodePushEdits(dir, true).length) return [];
  if (!force) {
    const d = dirtyFiles(dir);
    if (d.length) throw new CliFailure(`Git tree is not clean (${d.length} changed path(s)). Commit or stash first, or pass --force.`, "dirty_tree", 1, [{ command: "git status", why: "See what changed." }, { command: "shipvo migrate --apply --force", why: "Apply anyway. Backups go in " + BACKUP + "." }]);
  }
  return applyCodePushEdits(dir);
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
    if (apply && plan.system === "codepush") {
      const edits = applyCodePush(dir, argv.includes("--force"));
      const left = scanCodePush(dir);
      const manual = left.filter((f) => f.kind === "command" || f.kind === "wrapper" || f.kind === "sync")
        .map((f) => ({ where: f.where, entry: f.entry, why: f.kind === "command" ? "appcenter codepush command: replace with shipvo publish or shipvo rollback" : "CodePush call --apply could not rewrite: change it by hand" }));
      const pm = buildPlanPm(dir);
      if (!edits.length) {
        if (!json) {
          console.log("Nothing left to do: no CodePush code, keys or dependency remain that --apply can edit.");
          for (const m of manual) console.log(`  manual: ${m.where}: ${m.entry}`);
        }
        return { code: "nothing_left", summary: "Nothing left to do: no CodePush entries remain that --apply can edit.", data: { changed: [], manual, backupDir: BACKUP }, next: [{ command: "shipvo init --dry-run", why: "Preview what init adds." }] };
      }
      if (!json) {
        console.log("Changed:");
        for (const e of edits) { console.log(`  ${e.file}`); for (const r of e.removed) console.log(`    - ${r}`); }
        console.log(`\nBackups are in ${BACKUP}/.`);
        if (manual.length) { console.log("\nManual steps (left in place):"); for (const m of manual) console.log(`  - ${m.where}: ${m.entry}\n      ${m.why}`); }
        console.log(`\nNext: run ${pm} install to refresh the lockfile. I did not run it.`);
        console.log("Then create the Shipvo config (shipvo init in a scratch folder), build one new store build, and publish. Old binaries keep using CodePush.");
        console.log("See docs/migrate-from-codepush.md.");
      }
      return { code: "applied", summary: `Edited ${edits.length} file(s). Backups in ${BACKUP}. ${manual.length} manual step(s) left.`, data: { changed: edits, manual, backupDir: BACKUP, steps: plan.steps }, next: [{ command: `${pm} install`, why: "Refresh the lockfile after the dependency swap." }, { command: "shipvo init --dry-run", why: "Preview the Shipvo config; copy it into your app." }] };
    }
    if (!plan.system) {
      if (!json) console.log(apply ? "Nothing left to do: this app has no expo-updates or CodePush." : "Nothing to migrate: this app has no expo-updates or CodePush.");
      return { code: "nothing_to_migrate", summary: "Nothing to migrate: no expo-updates or CodePush found.", data: plan, next: [{ command: "shipvo init", why: "Add Shipvo to this app." }] };
    }
    if (!json) {
      console.log(`Found ${plan.system === "expo-updates" ? "expo-updates (EAS Update)" : "CodePush"}:`);
      for (const f of plan.found) console.log(`  - ${f.where}: ${f.entry}`);
      console.log("\nSteps, in this order:");
      plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      console.log(`\nNo files were changed. Details: ${plan.system === "codepush" ? "docs/migrate-from-codepush.md" : DOC}`);
    }
    return {
      code: "plan", summary: `${plan.found.length} entries found, ${plan.steps.length} steps. No files changed.`, data: plan,
      next: plan.system === "expo-updates"
        ? [{ command: `${buildPlanPm(dir)} remove expo-updates`, why: "Step 1 of the plan." }, { command: "shipvo init --dry-run", why: "Preview what init adds once expo-updates is gone." }]
        : [{ command: "shipvo init --dry-run", why: "Preview what init adds." }, { command: "cat docs/migrate-from-codepush.md", why: "Read the CodePush guide." }],
    };
  };
  if (json) { await runJson(run, [{ command: "shipvo help", why: "See the commands and flags." }]); return Number(process.exitCode ?? 0); }
  try { await run(); return 0; } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return e instanceof CliFailure ? e.exit : 1; }
}
