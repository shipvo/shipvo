// A Capacitor project's built web directory, for `shipvo sim` and `shipvo preview`.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

export type CapacitorWeb = { appId: string; webDir: string };

/** Reads capacitor.config.json or capacitor.config.ts (literal `appId` and `webDir` strings). Undefined when the folder is not a Capacitor project. */
export function capacitorWeb(root = process.cwd()): CapacitorWeb | undefined {
  const file = ["capacitor.config.json", "capacitor.config.ts", "capacitor.config.js"].map((f) => join(root, f)).find(existsSync);
  if (!file) return undefined;
  const src = readFileSync(file, "utf8");
  const pick = (k: string) => (file.endsWith(".json") ? (JSON.parse(src)[k] as string | undefined) : new RegExp(`\\b${k}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(src)?.[1]);
  const webDir = pick("webDir") ?? "www";
  const abs = isAbsolute(webDir) ? webDir : resolve(root, webDir);
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) return undefined;
  return { appId: pick("appId") ?? "capacitor-app", webDir: abs };
}
