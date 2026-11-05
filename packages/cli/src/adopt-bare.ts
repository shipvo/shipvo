// Adopt Shipvo in a bare React Native app (no Expo prebuild): write the native config by hand.
// This file holds the iOS half. It writes the same Info.plist keys as packages/runtime/app.plugin.js.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import plist from "plist";

export interface IosConfigValues {
  baseUrl: string;
  publicKey: string;
  appId: string;
  shellMajor?: number;
  /** Hermes bytecode versions, for example [96, 98]. Omit to write nothing. */
  hermesBytecodeVersions?: number[];
  /** Native module name to version. Omit to write nothing. */
  nativeModules?: Record<string, string>;
}

// Same rules and format as formatBytecodeVersions and formatNativeModules in app.plugin.js.
function bytecodeList(value: number[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("hermesBytecodeVersions must be an array of integers");
  for (const v of value) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`hermesBytecodeVersions must be non-negative integers, got ${JSON.stringify(v)}`);
  }
  return value.join(",");
}

function moduleList(value: Record<string, string> | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("nativeModules must be an object of package name to version");
  return Object.entries(value)
    .map(([name, version]) => {
      if (!name.trim()) throw new Error("nativeModules has an empty package name");
      if (typeof version !== "string" || !version.trim()) throw new Error(`nativeModules version for "${name}" must be a non-empty string`);
      if (/[,\s]/.test(version) || /[,\s]/.test(name)) throw new Error(`nativeModules entry "${name}": "${version}" has a comma or space where it cannot`);
      return `${name}@${version}`;
    })
    .join(",");
}

/** The Info.plist keys for these values. Optional keys are left out when their value is omitted. */
export function iosPlistEntries(values: IosConfigValues): Record<string, string> {
  const { baseUrl, publicKey, appId, shellMajor = 1 } = values;
  if (!baseUrl || !publicKey || !appId) throw new Error("baseUrl, publicKey and appId are required");
  const out: Record<string, string> = {
    ShipvoBaseURL: baseUrl,
    ShipvoPublicKey: publicKey,
    ShipvoAppId: appId,
    ShipvoShellMajor: String(shellMajor),
  };
  const hbc = bytecodeList(values.hermesBytecodeVersions);
  const nm = moduleList(values.nativeModules);
  if (hbc !== undefined) out.ShipvoHermesBytecodeVersions = hbc;
  if (nm !== undefined) out.ShipvoNativeModules = nm;
  return out;
}

/**
 * Set the Shipvo keys in an Info.plist. Other keys and their order stay. New keys go at the end.
 * Returns true when the file changed; a second run with the same values writes nothing.
 */
export function writeIosConfig(infoPlistPath: string, values: IosConfigValues): boolean {
  const entries = iosPlistEntries(values);
  const dict = plist.parse(readFileSync(infoPlistPath, "utf8")) as Record<string, plist.PlistValue>;
  if (Object.entries(entries).every(([k, v]) => dict[k] === v)) return false;
  Object.assign(dict, entries);
  writeFileSync(infoPlistPath, plist.build(dict, { indent: "\t", newline: "\n" }) + "\n");
  return true;
}

/** The app target's Info.plist: `ios/<name>/Info.plist`. Skips Pods and test targets. Undefined when none is found. */
export function findIosInfoPlist(dir = "."): string | undefined {
  const ios = join(dir, "ios");
  let entries;
  try { entries = readdirSync(ios, { withFileTypes: true }); } catch { return undefined; }
  const names = entries.filter((e) => e.isDirectory() && !/^Pods$|Tests$|\.(xcodeproj|xcworkspace|xcassets)$/.test(e.name)).map((e) => e.name).sort();
  const withPlist = names.filter((n) => existsSync(join(ios, n, "Info.plist")));
  // Prefer the folder named like the Xcode project.
  const project = entries.find((e) => e.name.endsWith(".xcodeproj"))?.name.replace(/\.xcodeproj$/, "");
  const pick = withPlist.find((n) => n === project) ?? withPlist[0];
  return pick ? join(ios, pick, "Info.plist") : undefined;
}

/** What to tell the user once both platforms are configured. */
export function adoptNextSteps(): string {
  return [
    "Next steps:",
    "  1. cd ios && pod install",
    "  2. Rebuild both apps (Android and iOS) so the native shells carry the new config.",
    "  3. shipvo publish --dry-run",
  ].join("\n");
}
