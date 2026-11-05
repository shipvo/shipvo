// Find the native modules an app needs: dependencies in package.json whose installed package has native code.
// A package counts as native if it ships an android/ or ios/ folder, a podspec, or an Expo/RN native config file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NATIVE_FILES = ["expo-module.config.json", "react-native.config.js"];
const RANGE = /^[\^~<>=v\d xX*|. -]+$/; // plain numeric ranges only; workspace:, file:, git, tag and pre-release specs are skipped and reported

function hasNativeCode(dir: string): boolean {
  if (NATIVE_FILES.some((f) => existsSync(join(dir, f)))) return true;
  if (existsSync(join(dir, "android")) || existsSync(join(dir, "ios"))) return true;
  try { return readdirSync(dir).some((f) => f.endsWith(".podspec")); } catch { return false; }
}

/** Package name to semver range, from `dependencies` of the project's package.json. Undefined when none are native. */
/** Native dependencies whose range was not recorded are pushed to `skipped` as `name@spec`. */
export function requiredNativeModules(root = ".", skipped: string[] = []): Record<string, string> | undefined {
  let pkg: { dependencies?: Record<string, string> };
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { return undefined; }
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(pkg.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!hasNativeCode(join(root, "node_modules", name))) continue;
    if (RANGE.test(range)) out[name] = range; else skipped.push(`${name}@${range}`);
  }
  return Object.keys(out).length ? out : undefined;
}
