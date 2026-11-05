// `shipvo init` inside an existing app ("adopt mode"): detect the project, show a plan, apply it only after
// confirmation. Never overwrites a file, never touches ios/ or android/. Bare React Native is built in #201.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { b64, keyFromSeed } from "./index.js";
import { runDoctorChecks } from "./doctor.js";

const HOSTED = "https://api.shipvo.dev";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type Project = {
  dir: string;
  isExpo: boolean;
  isBare: boolean;
  expoSdk: number | null;
  packageManager: PackageManager;
  configKind: "app.json" | "app.config.js" | "app.config.ts" | null;
  configFile: string | null;
  expoUpdates: boolean;
  codePush: boolean;
};

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** Reads the folder and says what kind of app it is. Changes nothing. */
export function detectProject(dir: string): Project {
  const pkg = readJson(join(dir, "package.json"));
  const deps: Record<string, string> = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const configFile = ["app.json", "app.config.ts", "app.config.js"].find((f) => existsSync(join(dir, f))) ?? null;
  const lock: [string, PackageManager][] = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]];
  const packageManager = lock.find(([f]) => existsSync(join(dir, f)))?.[1] ?? "npm";
  const sdk = /(\d+)\./.exec(String(deps.expo ?? ""))?.[1];
  const appJson = configFile === "app.json" ? readJson(join(dir, "app.json")) : null;
  const plugins: unknown[] = appJson?.expo?.plugins ?? appJson?.plugins ?? [];
  const hasNative = existsSync(join(dir, "ios")) && existsSync(join(dir, "android"));
  const isExpo = !!pkg && !!deps.expo && !!configFile;
  return {
    dir, isExpo, isBare: hasNative && plugins.length === 0 && configFile !== "app.config.js" && configFile !== "app.config.ts",
    expoSdk: sdk ? Number(sdk) : null, packageManager, configKind: configFile as Project["configKind"], configFile,
    expoUpdates: !!deps["expo-updates"] || plugins.some((p) => (Array.isArray(p) ? p[0] : p) === "expo-updates"),
    codePush: !!deps["react-native-code-push"] || !!deps["@revopush/react-native-code-push"],
  };
}

const ADOPT_FLAGS = new Set(["yes", "dry-run", "device"]);
type Step = { text: string; run: () => void };
export type AdoptDeps = { install: (pm: PackageManager, pkgs: string[], dir: string) => void; confirm: (q: string) => Promise<boolean>; doctor: boolean };

const defaultDeps: AdoptDeps = {
  install(pm, pkgs, dir) {
    const r = spawnSync(pm, [pm === "npm" ? "install" : "add", ...pkgs], { cwd: dir, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`${pm} could not install ${pkgs.join(", ")}`);
  },
  async confirm(q) {
    if (!process.stdin.isTTY) { console.error("shipvo: this is not a terminal, so I cannot ask. Re-run with --yes to apply the plan, or --dry-run to only read it."); process.exit(2); }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(q)).trim().toLowerCase(); rl.close();
    return ans === "y" || ans === "yes";
  },
  doctor: true,
};

/** Does argv ask for adopt mode: no folder, or ".". */
export const isAdoptArgs = (argv: string[]) => {
  const pos = positional(argv);
  return pos.length === 0 || (pos.length === 1 && pos[0] === ".");
};
const positional = (argv: string[]) => argv.filter((x, i) => !x.startsWith("-") && !(argv[i - 1]?.startsWith("--") && !ADOPT_FLAGS.has(argv[i - 1].slice(2))));
const flag = (argv: string[], n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };

export async function adopt(argv: string[], dir = process.cwd(), overrides: Partial<AdoptDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  dir = resolve(dir);
  const yes = argv.includes("--yes"), dry = argv.includes("--dry-run"), withDevice = argv.includes("--device");
  const fail = (msg: string, code = 1): never => { console.error(msg); process.exit(code); };
  const p = detectProject(dir);

  if (!existsSync(join(dir, "package.json")) || !p.isExpo) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "ios")) && existsSync(join(dir, "android")))
      return fail(bareNote());
    return fail(`shipvo: ${dir} is not an Expo app. Adopt mode needs a package.json with "expo" and an app.json or app.config.js/ts.\nTo start a new app, run:  shipvo init myshop`);
  }
  if (p.expoUpdates || p.codePush) {
    const what = p.expoUpdates ? "expo-updates" : "react-native-code-push";
    return fail(`shipvo: this app uses ${what}. Two over-the-air systems would fight over the bundle, so I stopped and changed nothing.\nRemove ${what} first. Steps: docs/migrate-from-codepush.md`);
  }
  if (p.isBare) return fail(bareNote());

  const pkg = readJson(join(dir, "package.json"));
  const have = (n: string) => !!(pkg.dependencies?.[n] ?? pkg.devDependencies?.[n]);
  const cfgPath = join(dir, "shipvo.json");
  const existingCfg = existsSync(cfgPath) ? readJson(cfgPath) : null;
  const seedPath = join(dir, ".shipvo", "seed.txt");
  const appJson = p.configKind === "app.json" ? readJson(join(dir, "app.json")) : null;
  const expo = appJson ? (appJson.expo ?? appJson) : null;
  const appId = (existingCfg?.appId ?? expo?.slug ?? String(pkg.name ?? "app").replace(/^@[^/]+\//, "")).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
  const name = existingCfg?.name ?? expo?.name ?? appId;
  const controlPlane = (flag(argv, "control-plane") ?? existingCfg?.controlPlane ?? HOSTED).replace(/\/$/, "");

  // Signing key: the one given, the one in shipvo.json, the seed already on disk, or a new one.
  let publicKey = flag(argv, "public-key") ?? existingCfg?.publicKey;
  let newSeed: string | null = null;
  if (!publicKey) {
    if (existsSync(seedPath)) publicKey = b64(keyFromSeed(readFileSync(seedPath, "utf8").trim()).publicKey);
    else { newSeed = b64(randomBytes(32)); publicKey = b64(keyFromSeed(newSeed).publicKey); }
  }
  const pluginProps = { baseUrl: controlPlane, publicKey, appId, shellMajor: 1 };

  const steps: Step[] = [];
  const wantPkgs = ["@shipvo/runtime", ...(withDevice ? ["@shipvo/device"] : [])].filter((n) => !have(n));
  if (wantPkgs.length) steps.push({ text: `Install ${wantPkgs.join(" and ")} with ${p.packageManager}`, run: () => deps.install(p.packageManager, wantPkgs, dir) });

  if (newSeed) steps.push({ text: "Create a signing key in .shipvo/seed.txt (git-ignored)", run: () => { mkdirSync(join(dir, ".shipvo"), { recursive: true }); writeFileSync(seedPath, newSeed!, { mode: 0o600 }); } });

  let printLines = false;
  if (p.configKind === "app.json") {
    const list: unknown[] = expo.plugins ?? [];
    if (!list.some((x) => (Array.isArray(x) ? x[0] : x) === "@shipvo/runtime"))
      steps.push({ text: "Add the @shipvo/runtime config plugin to app.json (with your public key)", run: () => {
        const raw = readFileSync(join(dir, "app.json"), "utf8");
        const j = JSON.parse(raw), target = j.expo ?? j;
        target.plugins = [...(target.plugins ?? []), ["@shipvo/runtime", pluginProps]];
        writeFileSync(join(dir, "app.json"), JSON.stringify(j, null, /\n\t/.test(raw) ? "\t" : 2) + "\n");
      } });
  } else printLines = true;

  if (!existingCfg) steps.push({ text: `Write shipvo.json (app id "${appId}")`, run: () => writeFileSync(cfgPath, JSON.stringify({ appId, name, shellMajor: 1, controlPlane, publicKey }, null, 2) + "\n") });

  const wantScripts = { sim: "shipvo sim", publish: "shipvo publish", rollback: "shipvo rollback" };
  const missing = Object.entries(wantScripts).filter(([k]) => !pkg.scripts?.[k]);
  if (missing.length) steps.push({ text: `Add package.json scripts: ${missing.map(([k]) => k).join(", ")}`, run: () => {
    const path = join(dir, "package.json"), raw = readFileSync(path, "utf8"), j = JSON.parse(raw);
    j.scripts = { ...j.scripts }; for (const [k, v] of missing) if (!j.scripts[k]) j.scripts[k] = v;
    writeFileSync(path, JSON.stringify(j, null, /\n\t/.test(raw) ? "\t" : 2) + "\n");
  } });

  const gi = join(dir, ".gitignore");
  const giText = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!giText.split(/\r?\n/).some((l) => /^\/?\.shipvo\/?$/.test(l.trim())))
    steps.push({ text: "Add .shipvo/ to .gitignore", run: () => writeFileSync(gi, giText + (giText && !giText.endsWith("\n") ? "\n" : "") + "# never commit the release signing seed\n.shipvo/\n") });

  const wf = join(dir, ".github", "workflows", "publish.yml");
  if (!existsSync(wf)) steps.push({ text: "Add .github/workflows/publish.yml", run: () => { mkdirSync(join(dir, ".github", "workflows"), { recursive: true }); writeFileSync(wf, PUBLISH_WORKFLOW(p.packageManager)); } });

  console.log(`Shipvo found an Expo app${p.expoSdk ? ` (SDK ${p.expoSdk})` : ""} in ${dir}\n  package manager: ${p.packageManager}   config: ${p.configFile}   expo-updates: no   CodePush: no\n`);
  if (!steps.length) { console.log("Nothing to change: this app is already set up for Shipvo."); }
  else {
    console.log("Plan:");
    steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.text}`));
  }
  if (printLines) console.log(`\n${p.configFile} is code, so I will not rewrite it. Add this to its "plugins" list:\n\n  ["@shipvo/runtime", ${JSON.stringify(pluginProps)}],\n`);
  console.log("\nI will not touch ios/ or android/, and I will not overwrite any file.");
  if (dry) { console.log("\n--dry-run: nothing was changed."); return; }
  if (!steps.length) return;
  if (!yes && !(await deps.confirm("\nApply this plan? [y/N] "))) { console.log("Nothing was changed."); return; }

  for (const s of steps) { s.run(); console.log(`done: ${s.text}`); }
  if (newSeed) console.log(`\nBack up .shipvo/seed.txt offline and put it in the SHIPVO_SIGNING_SEED secret of your CI. Lose it and you cannot publish to installed shells.`);

  if (deps.doctor) {
    console.log("\nshipvo doctor:");
    for (const r of await runDoctorChecks({ cwd: dir })) console.log(r.ok ? `PASS ${r.name}${r.note ? ` (${r.note})` : ""}` : `FAIL ${r.name} — fix: ${r.fix}`);
  }
  console.log(`\nNext steps:
  1. Rebuild the native app once so the runtime is in the shell: npx expo prebuild, then npx expo run:android (or run:ios)
  2. npx shipvo publish --dry-run   # see what a release would contain`);
}

const bareNote = () => `shipvo: this looks like a bare React Native app (ios/ and android/ are committed, no Expo config plugins).
Bare support will add the native config for the runtime and check that Expo modules are present. It is not available yet (see issue #201), so I changed nothing.`;

const PUBLISH_WORKFLOW = (pm: PackageManager) => `name: publish
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    concurrency: shipvo-publish
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: ${pm === "npm" ? "npm ci" : pm === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile" : pm === "yarn" ? "corepack enable && yarn install --immutable" : "npm i -g bun && bun install --frozen-lockfile"}
      - run: pip install --break-system-packages bsdiff4
      - name: Build, sign and publish over the air
        env:
          SHIPVO_PUBLISH_TOKEN: \${{ secrets.SHIPVO_PUBLISH_TOKEN }}
          SHIPVO_SIGNING_SEED: \${{ secrets.SHIPVO_SIGNING_SEED }}
        run: npx shipvo publish | tee -a "$GITHUB_STEP_SUMMARY"
`;
