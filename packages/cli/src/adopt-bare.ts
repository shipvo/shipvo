// Bare React Native adopt, slice 1: Android manifest and the Expo Modules check.
// Writes the same dev.shipvo.* meta-data as packages/runtime/app.plugin.js, without a prebuild.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ShipvoNativeValues {
  baseUrl: string;
  publicKey: string;
  appId: string;
  shellMajor?: number;
  hermesBytecodeVersions?: number[];
  nativeModules?: Record<string, string>;
}

/** Name and value pairs, in the order and format app.plugin.js writes them. */
export function androidMetaData(v: ShipvoNativeValues): Array<[string, string]> {
  if (!v.baseUrl || !v.publicKey || !v.appId) throw new Error("baseUrl, publicKey and appId are required");
  const out: Array<[string, string]> = [
    ["dev.shipvo.BASE_URL", v.baseUrl],
    ["dev.shipvo.PUBLIC_KEY", v.publicKey],
    ["dev.shipvo.APP_ID", v.appId],
    ["dev.shipvo.SHELL_MAJOR", String(v.shellMajor ?? 1)],
  ];
  if (v.hermesBytecodeVersions !== undefined) out.push(["dev.shipvo.HERMES_BYTECODE_VERSIONS", formatBytecodeVersions(v.hermesBytecodeVersions)]);
  if (v.nativeModules !== undefined) out.push(["dev.shipvo.NATIVE_MODULES", formatNativeModules(v.nativeModules)]);
  return out;
}

// Same rules as formatBytecodeVersions in packages/runtime/app.plugin.js.
function formatBytecodeVersions(value: unknown): string {
  if (!Array.isArray(value)) throw new Error("adopt-bare: hermesBytecodeVersions must be an array of integers");
  for (const v of value) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`adopt-bare: hermesBytecodeVersions must be non-negative integers, got ${JSON.stringify(v)}`);
    }
  }
  return value.join(",");
}

// Same rules as formatNativeModules in packages/runtime/app.plugin.js.
function formatNativeModules(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("adopt-bare: nativeModules must be an object of package name to version");
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([name, version]) => {
      if (!name.trim()) throw new Error("adopt-bare: nativeModules has an empty package name");
      if (typeof version !== "string" || !version.trim()) {
        throw new Error(`adopt-bare: nativeModules version for "${name}" must be a non-empty string`);
      }
      if (/[,\s]/.test(version) || /[,\s]/.test(name)) {
        throw new Error(`adopt-bare: nativeModules entry "${name}": "${version}" has a comma or space where it cannot`);
      }
      return `${name}@${version}`;
    })
    .join(",");
}

/** Returns the manifest path if `dir/android/app/src/main/AndroidManifest.xml` exists, else null. */
export function findAndroidManifest(dir: string): string | null {
  const p = join(dir, "android", "app", "src", "main", "AndroidManifest.xml");
  return existsSync(p) ? p : null;
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const unescAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Same length as the input, with comments and CDATA blanked, so offsets match the original.
const mask = (s: string) => s.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => " ".repeat(m.length));

/** Adds or updates the dev.shipvo.* meta-data in `<application>`. Returns true if the file changed. */
export function writeAndroidConfig(manifestPath: string, values: ShipvoNativeValues): boolean {
  const original = readFileSync(manifestPath, "utf8");
  const next = applyAndroidConfig(original, values);
  if (next === original) return false;
  writeFileSync(manifestPath, next);
  return true;
}

export function applyAndroidConfig(xml: string, values: ShipvoNativeValues): string {
  const items = androidMetaData(values);
  let text = xml;
  let m = /<application(?=[\s/>])/.exec(mask(text));
  if (!m) throw new Error("AndroidManifest.xml has no <application> element");
  const start = m.index;
  // End of the opening tag, skipping quoted attribute values.
  let i = start + "<application".length;
  let quote = "";
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = ""; } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") break;
  }
  if (i >= text.length) throw new Error("AndroidManifest.xml has an unterminated <application> tag");
  const lineStart = text.lastIndexOf("\n", start) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, start))![0];
  const inner = indent + "  ";
  const line = ([n, v]: [string, string]) => `${inner}<meta-data android:name="${n}" android:value="${escAttr(v)}"/>`;

  if (text[i - 1] === "/") {
    // Self-closed: open it up. Keep the attributes exactly as they were.
    const head = text.slice(start, i - 1).replace(/[ \t]+$/, "");
    return text.slice(0, start) + head + ">\n" + items.map(line).join("\n") + "\n" + indent + "</application>" + text.slice(i + 1);
  }

  const close = mask(text).indexOf("</application", i);
  if (close < 0) throw new Error("AndroidManifest.xml has no </application>");
  let body = text.slice(i + 1, close);
  const maskedBody = mask(body);
  const missing: Array<[string, string]> = [];
  for (const [name, value] of items) {
    const re = /<meta-data\b(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
    let found = false;
    let e: RegExpExecArray | null;
    while ((e = re.exec(maskedBody))) {
      const nm = /android:name\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(e[0]);
      if (!nm || unescAttr(nm[1] ?? nm[2]) !== name) continue;
      found = true;
      const tag = body.slice(e.index, e.index + e[0].length);
      const vm = /(android:value\s*=\s*)(?:"([^"]*)"|'([^']*)')/.exec(tag);
      let newTag: string;
      if (vm) {
        if (unescAttr(vm[2] ?? vm[3]) === value) break;
        newTag = tag.slice(0, vm.index) + `${vm[1]}"${escAttr(value)}"` + tag.slice(vm.index + vm[0].length);
      } else {
        newTag = tag.replace(/\s*\/?>$/, (end) => ` android:value="${escAttr(value)}"${end.trim()}`);
      }
      body = body.slice(0, e.index) + newTag + body.slice(e.index + tag.length);
      // Offsets after this point moved; rebuild is simplest, so stop and re-run for the rest.
      return applyAndroidConfig(text.slice(0, i + 1) + body + text.slice(close), values);
    }
    if (!found) missing.push([name, value]);
  }
  if (missing.length === 0) return text;
  const closeLineStart = text.lastIndexOf("\n", close) + 1;
  const onOwnLine = /^[ \t]*$/.test(text.slice(closeLineStart, close));
  const add = missing.map(line).join("\n") + "\n";
  if (onOwnLine) return text.slice(0, closeLineStart) + add + text.slice(closeLineStart);
  return text.slice(0, close) + "\n" + add + indent + text.slice(close);
}

export interface ExpoModulesCheck {
  installed: boolean;
  expoPackage: boolean;
  android: boolean;
  ios: boolean;
  /** Steps to run by hand. Never run by this function. */
  plan: string[];
}

function walk(dir: string, match: RegExp, depth = 8): string | null {
  if (depth < 0 || !existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "Pods" || e.name === "build") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { const r = walk(p, match, depth - 1); if (r) return r; }
    else if (match.test(e.name)) return p;
  }
  return null;
}

/** Reports whether Expo Modules are set up in a bare app. Read-only. */
export function checkExpoModules(dir: string): ExpoModulesCheck {
  let expoPackage = false;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expoPackage = Boolean(pkg.dependencies?.expo ?? pkg.devDependencies?.expo);
  } catch { /* no package.json: not installed */ }
  const has = (file: string | null, re: RegExp) => (file ? re.test(readFileSync(file, "utf8")) : false);
  const android = has(walk(join(dir, "android", "app", "src", "main", "java"), /^MainApplication\.(kt|java)$/),
    /expo\.modules\.(ApplicationLifecycleDispatcher|ReactNativeHostWrapper)|ExpoModulesPackage/);
  const ios = has(walk(join(dir, "ios"), /^AppDelegate\.(swift|mm?|h)$/), /\bExpo(AppDelegate|ReactDelegate|Modules)?\b|import Expo/);
  const installed = expoPackage && android && ios;
  return { installed, expoPackage, android, ios, plan: installed ? [] : ["npx install-expo-modules@latest"] };
}
