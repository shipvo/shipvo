// Adopt mode for bare React Native apps: writes the same native values as packages/runtime/app.plugin.js
// straight into Info.plist and AndroidManifest.xml, because a bare app has no Expo prebuild to run the plugin.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import plist from "plist";

export interface ShipvoNativeValues {
  baseUrl: string;
  publicKey: string;
  appId: string;
  shellMajor?: number;
  hermesBytecodeVersions?: number[];
  nativeModules?: Record<string, string>;
}

export const INSTALL_EXPO_MODULES = "npx install-expo-modules@latest";

// Same validation and formatting as app.plugin.js.
function formatBytecodeVersions(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("hermesBytecodeVersions must be an array of integers");
  for (const v of value) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`hermesBytecodeVersions must be non-negative integers, got ${JSON.stringify(v)}`);
  }
  return value.join(",");
}

function formatNativeModules(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("nativeModules must be an object of package name to version");
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([name, version]) => {
      if (!name.trim()) throw new Error("nativeModules has an empty package name");
      if (typeof version !== "string" || !version.trim()) throw new Error(`nativeModules version for "${name}" must be a non-empty string`);
      if (/[,\s]/.test(version) || /[,\s]/.test(name)) throw new Error(`nativeModules entry "${name}": "${version}" has a comma or space where it cannot`);
      return `${name}@${version}`;
    })
    .join(",");
}

function entries(values: ShipvoNativeValues, prefix: "ios" | "android"): [string, string][] {
  const { baseUrl, publicKey, appId, shellMajor = 1 } = values;
  if (!baseUrl || !publicKey || !appId) throw new Error("baseUrl, publicKey and appId are required");
  const hbc = formatBytecodeVersions(values.hermesBytecodeVersions);
  const nm = formatNativeModules(values.nativeModules);
  const names = prefix === "ios"
    ? ["ShipvoBaseURL", "ShipvoPublicKey", "ShipvoAppId", "ShipvoShellMajor", "ShipvoHermesBytecodeVersions", "ShipvoNativeModules"]
    : ["dev.shipvo.BASE_URL", "dev.shipvo.PUBLIC_KEY", "dev.shipvo.APP_ID", "dev.shipvo.SHELL_MAJOR", "dev.shipvo.HERMES_BYTECODE_VERSIONS", "dev.shipvo.NATIVE_MODULES"];
  const vals = [baseUrl, publicKey, appId, String(shellMajor), hbc, nm];
  const out: [string, string][] = [];
  names.forEach((n, i) => { const v = vals[i]; if (v !== undefined) out.push([n, v]); });
  return out;
}

/** Sets the Shipvo keys in an Info.plist. Other keys keep their values and order; XML comments and the original whitespace are lost on the first write. Returns true if the file changed. */
export function writeIosConfig(infoPlistPath: string, values: ShipvoNativeValues): boolean {
  const want = entries(values, "ios");
  const original = readFileSync(infoPlistPath, "utf8");
  const dict = plist.parse(original) as Record<string, unknown>;
  if (want.every(([k, v]) => dict[k] === v)) return false;
  for (const [k, v] of want) dict[k] = v;
  const out = plist.build(dict as plist.PlistObject);
  writeFileSync(infoPlistPath, out.endsWith("\n") ? out : out + "\n");
  return true;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Adds or updates the dev.shipvo.* meta-data inside <application>. Everything else stays byte for byte. Returns true if changed. */
export function writeAndroidConfig(manifestPath: string, values: ShipvoNativeValues): boolean {
  const want = entries(values, "android");
  const original = readFileSync(manifestPath, "utf8");
  let xml = original;
  // Assumes stock React Native manifests: each <meta-data> is one tag with no ">" inside attribute values.
  for (const [name, value] of want) {
    const existing = new RegExp(`<meta-data\\b[^>]*android:name\\s*=\\s*"${escapeRe(name)}"[^>]*?/?>`);
    const m = existing.exec(xml);
    if (m) {
      const tag = m[0];
      const next = /android:value\s*=\s*"[^"]*"/.test(tag)
        ? tag.replace(/android:value\s*=\s*"[^"]*"/, () => `android:value="${xmlEscape(value)}"`)
        : tag.replace(/\s*\/?>$/, (end) => ` android:value="${xmlEscape(value)}"${end}`);
      xml = xml.slice(0, m.index) + next + xml.slice(m.index + tag.length);
      continue;
    }
    const close = xml.lastIndexOf("</application>");
    if (close < 0) throw new Error(`${manifestPath}: no <application> element with a closing tag`);
    const lineStart = xml.lastIndexOf("\n", close) + 1;
    const indent = /^[ \t]*$/.test(xml.slice(lineStart, close)) ? xml.slice(lineStart, close) : "";
    const eol = xml.includes("\r\n") ? "\r\n" : "\n";
    const line = `${indent}  <meta-data android:name="${name}" android:value="${xmlEscape(value)}"/>${eol}`;
    const at = indent || lineStart === close ? lineStart : close;
    xml = xml.slice(0, at) + (at === close ? eol : "") + line + xml.slice(at);
  }
  if (xml === original) return false;
  writeFileSync(manifestPath, xml);
  return true;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
}

/** The app target's Info.plist: from the Xcode project when it names one, else ios/<name>/Info.plist. */
export function findIosInfoPlist(dir: string): string | undefined {
  const ios = join(dir, "ios");
  const skip = (p: string) => /Tests?(\/|$)|Tests?\.plist|(^|\/)Pods(\/|$)/.test(p);
  const found = new Set<string>();
  for (const proj of listDirs(ios).filter((n) => n.endsWith(".xcodeproj"))) {
    const pbx = join(ios, proj, "project.pbxproj");
    if (!existsSync(pbx)) continue;
    for (const m of readFileSync(pbx, "utf8").matchAll(/INFOPLIST_FILE\s*=\s*"?([^";\n]+?)"?;/g)) {
      const rel = m[1].replace(/^\$\((SRCROOT|PROJECT_DIR)\)\//, "");
      if (!rel.includes("$") && !skip(rel) && existsSync(join(ios, rel))) found.add(join(ios, rel));
    }
  }
  if (found.size > 0) {
    // Several targets (extensions, widgets, watch app) can list a plist. Prefer the one in the folder named like the .xcodeproj, then like the package name.
    const names = listDirs(ios).filter((n) => n.endsWith(".xcodeproj")).map((n) => n.replace(/\.xcodeproj$/, ""));
    try { names.push(String(JSON.parse(readFileSync(join(dir, "app.json"), "utf8")).name ?? "")); } catch { /* no app.json */ }
    const list = [...found];
    for (const name of names.filter(Boolean)) {
      const hit = list.find((f) => f.startsWith(join(ios, name) + "/"));
      if (hit) return hit;
    }
    return list[0];
  }
  for (const n of listDirs(ios)) {
    const p = join(ios, n, "Info.plist");
    if (!skip(n) && existsSync(p)) return p;
  }
  return undefined;
}

export function findAndroidManifest(dir: string): string | undefined {
  const p = join(dir, "android/app/src/main/AndroidManifest.xml");
  return existsSync(p) ? p : undefined;
}

function walk(dir: string, match: RegExp, depth = 8): string[] {
  if (depth < 0 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === "Pods" || n === "build" || n === "node_modules") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, match, depth - 1));
    else if (match.test(n)) out.push(p);
  }
  return out;
}

export interface ExpoModulesCheck {
  installed: boolean;
  /** What is missing, in plain words. Empty when installed. */
  missing: string[];
  /** The plan step to show when Expo Modules are missing. */
  planStep?: string;
}

/** Reports whether Expo Modules are set up: the `expo` package, MainApplication and AppDelegate. */
export function checkExpoModules(dir: string): ExpoModulesCheck {
  const missing: string[] = [];
  let hasExpo = false;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    hasExpo = Boolean(pkg.dependencies?.expo || pkg.devDependencies?.expo);
  } catch { /* no package.json: expo is missing */ }
  if (!hasExpo) missing.push("the expo package");
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const mains = walk(join(dir, "android/app/src/main"), /^MainApplication\.(kt|java)$/);
  if (!mains.some((f) => /ApplicationLifecycleDispatcher|ReactNativeHostWrapper|expo\.modules/.test(stripComments(readFileSync(f, "utf8"))))) {
    missing.push("the Expo setup in MainApplication");
  }
  const delegates = walk(join(dir, "ios"), /^AppDelegate\.(swift|mm?|h)$/);
  if (!delegates.some((f) => /ExpoAppDelegate|ExpoReactNativeFactory|import Expo|<Expo\//.test(stripComments(readFileSync(f, "utf8"))))) missing.push("the Expo setup in AppDelegate");
  return missing.length === 0 ? { installed: true, missing } : { installed: false, missing, planStep: INSTALL_EXPO_MODULES };
}

/** Runs install-expo-modules only when the caller confirmed (or passed --yes). Returns true if it ran. */
export async function installExpoModules(
  dir: string,
  opts: { yes?: boolean; confirm?: (question: string) => Promise<boolean>; run?: (cmd: string, cwd: string) => number },
): Promise<boolean> {
  const ok = opts.yes === true || (opts.confirm ? await opts.confirm(`Run \`${INSTALL_EXPO_MODULES}\` in ${dir}?`) : false);
  if (!ok) return false;
  const run = opts.run ?? ((cmd, cwd) => spawnSync(cmd, { cwd, shell: true, stdio: "inherit" }).status ?? 1);
  if (run(INSTALL_EXPO_MODULES, dir) !== 0) throw new Error(`${INSTALL_EXPO_MODULES} failed`);
  return true;
}

export const BARE_NEXT_STEPS = [
  "cd ios && pod install",
  "Rebuild both apps (iOS and Android)",
  "shipvo publish --dry-run",
];
