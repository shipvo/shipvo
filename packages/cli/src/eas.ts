// `shipvo eas setup` and `shipvo eas build`: make a Capacitor repo ready for `eas build` and `eas submit`
// with the customer's own Expo account. Shipvo writes files; it never holds Expo credentials.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const ANDROID_IMAGE = "latest";
export const IOS_IMAGE = "macos-tahoe-26.5-xcode-26.6";
export const NODE_VERSION = "22";
export const JDK_VERSION = "21";
const SCHEME_PATH = "ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme";
const SHIM = "ios/App.xcodeproj";
const SHIM_TARGET = "App/App.xcodeproj";

export interface CapacitorProject { configFile: string; android: boolean; ios: boolean }

/** Look for a Capacitor project at `root`. Returns undefined when it is not one. */
export function detectCapacitor(root: string): CapacitorProject | undefined {
  const configFile = readdirSync(root).find((f) => /^capacitor\.config\.(ts|js|json|mjs|cjs)$/.test(f));
  const android = existsSync(join(root, "android"));
  const ios = existsSync(join(root, "ios/App/App.xcodeproj"));
  if (!configFile || (!android && !ios)) return undefined;
  return { configFile, android, ios };
}

const androidYaml = `# Written by \`shipvo eas setup\`. Safe to edit; setup will not overwrite this file.
# Docs: https://docs.expo.dev/custom-builds/get-started/
build:
  name: Capacitor Android release
  steps:
    - eas/checkout
    - eas/install_node_modules
    - run:
        name: Install JDK ${JDK_VERSION}
        command: |
          source "$HOME/.sdkman/bin/sdkman-init.sh"
          sdk install java ${JDK_VERSION}-tem < /dev/null
          set-env JAVA_HOME "$(sdk home java ${JDK_VERSION}-tem)"
    - run:
        name: Build the web app
        command: npm run build
    - run:
        name: Sync Capacitor
        command: npx cap sync android
    - eas/inject_android_credentials
    - eas/run_gradle:
        inputs:
          command: :app:bundleRelease
    - eas/find_and_upload_build_artifacts
`;

const iosYaml = `# Written by \`shipvo eas setup\`. Safe to edit; setup will not overwrite this file.
# Docs: https://docs.expo.dev/custom-builds/get-started/
# Before the first build, run \`shipvo eas build\`: it creates the ios/App.xcodeproj link that EAS credential steps need.
build:
  name: Capacitor iOS release
  steps:
    - eas/checkout
    - eas/install_node_modules
    - run:
        name: Build the web app
        command: npm run build
    - run:
        name: Sync Capacitor
        command: npx cap sync ios
    - run:
        name: Install CocoaPods dependencies
        command: cd ios/App && pod install
    - eas/resolve_apple_team_id_from_credentials:
        id: resolve_apple_team_id
    - eas/prebuild_credentials_ios:
        inputs:
          project_dir: ios
    - eas/configure_ios_credentials
    - run:
        name: Archive with distribution signing
        command: |
          xcodebuild archive \\
            -workspace ios/App/App.xcworkspace \\
            -scheme App \\
            -configuration Release \\
            -archivePath build/App.xcarchive \\
            DEVELOPMENT_TEAM="\${{ steps.resolve_apple_team_id.outputs.apple_team_id }}" \\
            CODE_SIGN_STYLE=Manual
          xcodebuild -exportArchive \\
            -archivePath build/App.xcarchive \\
            -exportPath build/export \\
            -exportOptionsPlist ios/App/ExportOptions.plist
    - eas/find_and_upload_build_artifacts
`;

const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries>
      <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
        <BuildableReference BuildableIdentifier="primary" BlueprintName="App" BuildableName="App.app" BlueprintIdentifier="504EC3011FED79650016851F" ReferencedContainer="container:App.xcodeproj"/>
      </BuildActionEntry>
    </BuildActionEntries>
  </BuildAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`;

export interface PlannedFile { path: string; content: string; action: "create" | "update" }

function readJson(path: string): Record<string, any> {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`${path} is not valid JSON. Fix it and run the command again.`);
  }
}

/** Merge our profiles into an existing eas.json without touching the customer's own settings. */
function easJson(root: string, p: CapacitorProject): string {
  const j = readJson(join(root, "eas.json"));
  j.cli = { appVersionSource: "remote", ...(j.cli ?? {}) };
  j.build ??= {};
  if (p.android) j.build["shipvo-android"] ??= { android: { image: ANDROID_IMAGE, buildType: "app-bundle", config: "android.yml" }, distribution: "store" };
  if (p.ios) j.build["shipvo-ios"] ??= { ios: { image: IOS_IMAGE, node: NODE_VERSION, config: "ios.yml" }, distribution: "store", autoIncrement: true };
  j.submit ??= {};
  if (p.android) j.submit["shipvo-android"] ??= { android: {} };
  if (p.ios) j.submit["shipvo-ios"] ??= { ios: {} };
  return JSON.stringify(j, null, 2) + "\n";
}

function gitignore(root: string): string | undefined {
  const path = join(root, ".gitignore");
  const cur = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (cur.split(/\r?\n/).some((l) => l.trim() === SHIM)) return undefined;
  const sep = cur === "" || cur.endsWith("\n") ? "" : "\n";
  return `${cur}${sep}# Created by \`shipvo eas build\` for EAS; never commit\n${SHIM}\n`;
}

/** Work out which files need writing. Existing build YAMLs and schemes are never overwritten. */
export function planEasSetup(root: string, p: CapacitorProject): PlannedFile[] {
  const out: PlannedFile[] = [];
  const add = (path: string, content: string, overwrite: boolean) => {
    const exists = existsSync(join(root, path));
    if (exists && !overwrite) return;
    if (exists && readFileSync(join(root, path), "utf8") === content) return;
    out.push({ path, content, action: exists ? "update" : "create" });
  };
  add("eas.json", easJson(root, p), true);
  if (p.android) add(".eas/build/android.yml", androidYaml, false);
  if (p.ios) {
    add(".eas/build/ios.yml", iosYaml, false);
    add(SCHEME_PATH, scheme, false);
  }
  const gi = p.ios ? gitignore(root) : undefined;
  if (gi !== undefined) out.push({ path: ".gitignore", content: gi, action: existsSync(join(root, ".gitignore")) ? "update" : "create" });
  return out;
}

/** Create the `ios/App.xcodeproj -> App/App.xcodeproj` link EAS needs to find the scheme. Returns true if it made one. */
export function ensureSchemeShim(root: string): boolean {
  const link = join(root, SHIM);
  try { lstatSync(link); return false; } catch { /* missing: create it */ }
  symlinkSync(SHIM_TARGET, link, "dir");
  return true;
}

export const ONE_TIME_STEPS = [
  ["eas", "init"],
  ["eas", "build:version:set", "-p", "ios"],
] as const;

export type Runner = (cmd: string, args: string[], cwd: string) => number;
const defaultRunner: Runner = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: "inherit" }).status ?? 1;

export interface EasOptions { cwd?: string; log?: (s: string) => void; runner?: Runner }

export async function easCmd(args: string[], o: EasOptions = {}): Promise<number> {
  const cwd = o.cwd ?? process.cwd();
  const log = o.log ?? ((s: string) => console.log(s));
  const runner = o.runner ?? defaultRunner;
  const [sub, ...rest] = args;
  if (sub !== "setup" && sub !== "build") {
    throw new Error("Usage: shipvo eas setup [--dry-run] [--run] | shipvo eas build [eas build args]");
  }
  const project = detectCapacitor(cwd);
  if (!project) throw new Error("This is not a Capacitor project. Run this in a folder with capacitor.config.* and an android/ or ios/App/App.xcodeproj folder.");

  if (sub === "build") {
    if (project.ios && ensureSchemeShim(cwd)) log(`Linked ${SHIM} -> ${SHIM_TARGET} (git-ignored).`);
    return runner("npx", ["eas-cli", "build", ...rest], cwd);
  }

  const dry = rest.includes("--dry-run");
  const plan = planEasSetup(cwd, project);
  for (const f of plan) {
    log(`${dry ? "Would " + f.action : f.action === "create" ? "Created" : "Updated"} ${f.path}`);
    if (dry) log(f.content.replace(/^/gm, "  "));
    else { mkdirSync(dirname(join(cwd, f.path)), { recursive: true }); writeFileSync(join(cwd, f.path), f.content); }
  }
  if (!plan.length) log("Nothing to change: this repo is already set up for EAS.");
  if (dry) return 0;
  log("\nRemaining one-time steps:");
  for (const s of ONE_TIME_STEPS) log(`  npx ${s.join(" ")}`);
  if (project.ios) log("Before an iOS build, build with `shipvo eas build -p ios --profile shipvo-ios`: it creates the git-ignored ios/App.xcodeproj link first.");
  if (rest.includes("--run")) {
    for (const s of ONE_TIME_STEPS) {
      if (s[1] === "build:version:set" && !project.ios) continue;
      const code = runner("npx", [...s], cwd);
      if (code !== 0) { log(`\`npx ${s.join(" ")}\` failed (exit ${code}). Fix that and run it again.`); return code; }
    }
  }
  return 0;
}
