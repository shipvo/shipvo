// Capacitor projects are web apps: `shipvo sim` and `shipvo preview` open the built web directory (`webDir`) as it is.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { detectCapacitor } from "./eas.js";

/** True when `root` is a Capacitor project that is not an Expo app (Expo apps keep using `expo export`). */
export function isCapacitorWeb(root: string): boolean {
  if (existsSync(join(root, "app.json")) || existsSync(join(root, "app.config.ts")) || existsSync(join(root, "app.config.js"))) return false;
  try { return !!detectCapacitor(root); } catch { return false; }
}

/** The `webDir` set in capacitor.config.* (default `www`), as an absolute path inside `root`. */
export function capacitorWebDir(root: string): string {
  const file = detectCapacitor(root)?.configFile;
  let dir = "www";
  if (file) {
    const text = readFileSync(join(root, file), "utf8");
    const m = /["']?webDir["']?\s*:\s*(["'`])([^"'`]+)\1/.exec(text);
    if (m) dir = m[2];
  }
  const abs = isAbsolute(dir) ? dir : resolve(root, dir);
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) throw new Error(`capacitor.config webDir "${dir}" is outside the project.`);
  return abs;
}

/** Copies the built web directory to `out`. Throws a plain message when it has not been built. */
export function copyCapacitorWeb(root: string, out: string): void {
  const src = capacitorWebDir(root);
  if (!existsSync(join(src, "index.html"))) throw new Error(`No index.html in ${src}. Build your web app first (for example \`npm run build\`, then \`npx cap copy\`).`);
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
}
