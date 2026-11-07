import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectProject, type PackageManager } from "./adopt.js";

/** pnpm 11 holds back versions newer than its minimum release age. These names are always allowed. */
export const RELEASE_AGE_EXCLUDE = ["@shipvo/*", "shipvo", "create-shipvo"];

const KEY = "minimumReleaseAgeExclude";
const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, "$2");

/** Adds the Shipvo packages to `minimumReleaseAgeExclude` in a pnpm-workspace.yaml text. Keeps everything already there. */
export function mergeReleaseAgeExclude(text: string): string {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const at = lines.findIndex((l) => l.startsWith(`${KEY}:`));
  const block = (have: string[]) => RELEASE_AGE_EXCLUDE.filter((n) => !have.includes(n));
  if (at < 0) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${KEY}:`, ...RELEASE_AGE_EXCLUDE.map((n) => `  - "${n}"`));
    return lines.join(nl) + nl;
  }
  const inline = lines[at].slice(KEY.length + 1).trim();
  if (inline.startsWith("[") && inline.endsWith("]")) {
    const have = inline.slice(1, -1).split(",").map(unquote).filter(Boolean);
    const add = block(have);
    if (!add.length) return text;
    lines[at] = `${KEY}: [${[...inline.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean), ...add.map((n) => `"${n}"`)].join(", ")}]`;
    return lines.join(nl);
  }
  let end = at + 1;
  const have: string[] = [];
  let indent = "  ";
  while (end < lines.length && (/^\s*-\s/.test(lines[end]) || /^\s*-$/.test(lines[end]) || /^\s*#/.test(lines[end]) || lines[end].trim() === "")) {
    const m = /^(\s*)-\s+(.*?)(\s+#.*)?$/.exec(lines[end]);
    if (m) { have.push(unquote(m[2])); indent = m[1]; }
    end++;
  }
  while (end > at + 1 && lines[end - 1].trim() === "") end--;
  const add = block(have);
  if (!add.length) return text;
  lines.splice(end, 0, ...add.map((n) => `${indent}- "${n}"`));
  return lines.join(nl);
}

/** Creates or updates pnpm-workspace.yaml in `dir`. npm and bun ignore the file. */
export function writeReleaseAgeExclude(dir: string): void {
  const p = join(dir, "pnpm-workspace.yaml");
  const old = existsSync(p) ? readFileSync(p, "utf8") : "";
  const next = mergeReleaseAgeExclude(old);
  if (next === old) return;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, next);
}

/** 1 if a is newer than b, -1 if older, 0 if equal. Prerelease tags sort before the release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { n: core.split(".").map((x) => Number(x) || 0), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

export type Latest = { version: string; commands: string[] | null };

/** Asks the npm registry for the newest @shipvo/cli. Returns null when it cannot be reached. */
export async function fetchLatestCli(fetchFn: typeof fetch = fetch): Promise<Latest | null> {
  try {
    const res = await fetchFn("https://registry.npmjs.org/@shipvo%2fcli/latest", { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (typeof j?.version !== "string") return null;
    return { version: j.version, commands: Array.isArray(j.shipvoCommands) ? j.shipvoCommands.filter((c: unknown) => typeof c === "string") : null };
  } catch { return null; }
}

/** The command that installs the newest CLI with the app's package manager. */
export function updateCommand(pm: PackageManager): string {
  switch (pm) {
    case "pnpm": return "pnpm add -D @shipvo/cli@latest";
    case "yarn": return "yarn add -D @shipvo/cli@latest";
    case "bun": return "bun add -d @shipvo/cli@latest";
    default: return "npm install -D @shipvo/cli@latest";
  }
}

export function installedCliVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version as string;
}

/** The sentence for an unknown command that a newer CLI has, or null. */
export async function newerCliHasCommand(cmd: string, cwd = process.cwd(), installed = installedCliVersion(), fetchFn: typeof fetch = fetch): Promise<string | null> {
  const latest = await fetchLatestCli(fetchFn);
  if (!latest || compareVersions(latest.version, installed) <= 0 || !latest.commands?.includes(cmd)) return null;
  return `'${cmd}' is in @shipvo/cli ${latest.version}; you have ${installed}. Update with: ${updateCommand(detectProject(cwd).packageManager)}`;
}

/** Look up the registry for an unknown command only in an interactive terminal, so scripts and CI never wait. */
export function shouldCheckUpdates(env: NodeJS.ProcessEnv = process.env, stderrIsTTY: boolean = !!process.stderr.isTTY): boolean {
  return !env.CI && stderrIsTTY;
}
