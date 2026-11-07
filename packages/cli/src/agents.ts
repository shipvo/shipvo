import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { args } from "./config.js";
import { detectPackageManager, type PackageManager } from "./ensure-playwright.js";

export type ProjectKind = "shipvo" | "expo" | "react-native" | "capacitor" | "unknown";

export const BEGIN = "<!-- shipvo:begin -->";
export const END = "<!-- shipvo:end -->";
export const SKILL_LINE = "npx skills add shipvo/shipvo --skill shipvo -g";

/** What kind of app lives in `dir`. A shipvo.json wins; then Capacitor, Expo, bare React Native. */
export function detectProject(dir: string): ProjectKind {
  if (existsSync(join(dir, "shipvo.json"))) return "shipvo";
  let deps: Record<string, unknown> = {};
  try {
    const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    deps = { ...p.devDependencies, ...p.dependencies };
  } catch { /* no package.json */ }
  if (existsSync(join(dir, "capacitor.config.ts")) || existsSync(join(dir, "capacitor.config.json")) || "@capacitor/core" in deps) return "capacitor";
  if ("expo" in deps) return "expo";
  if ("react-native" in deps) return "react-native";
  return "unknown";
}

const LABEL: Record<ProjectKind, string> = { shipvo: "a Shipvo app", expo: "an Expo app", "react-native": "a bare React Native app", capacitor: "a Capacitor app", unknown: "an app" };

/** The text between (and including) our markers. */
export function agentsSection(kind: ProjectKind): string {
  return [
    BEGIN,
    "## Shipvo",
    "",
    `This project is ${LABEL[kind]} that uses Shipvo for over-the-air updates and the app simulator.`,
    "",
    "- Use `shipvo` commands instead of editing release or signing files by hand.",
    "- When you are not sure what to do next, run `shipvo status --json`. It prints `next`: the commands to run and why.",
    "- Exit codes of `shipvo status --json`: 0 ok, 1 action needed, 2 error.",
    "- To drive the app, use the `shipvo` MCP server from `.mcp.json` (`@shipvo/mcp`).",
    END,
  ].join("\n");
}

/** Put `section` between the markers. Text outside the markers is never changed. Returns null when the markers are broken (one missing, or END before BEGIN). */
export function upsertSection(text: string, section: string): string | null {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if ((b === -1) !== (e === -1) || (b !== -1 && e < b)) return null;
  if (b !== -1 && e !== -1) return text.slice(0, b) + section + text.slice(e + END.length);
  if (!text.trim()) return section + "\n";
  return text.replace(/\n*$/, "\n\n") + section + "\n";
}

export type McpServerEntry = { command: string; args: string[]; env?: Record<string, string> };

/** The sim port from shipvo.json (`simPort`), else 4545. */
export function simUrl(dir: string): string {
  try {
    const p = JSON.parse(readFileSync(join(dir, "shipvo.json"), "utf8")).simPort;
    if (Number.isInteger(p) && p > 0 && p < 65536) return `http://localhost:${p}`;
  } catch { /* no shipvo.json */ }
  return "http://localhost:4545";
}

/** The version of @shipvo/mcp installed in the app, or null. */
export function installedMcpVersion(dir: string): string | null {
  try { return JSON.parse(readFileSync(createRequire(join(dir, "package.json")).resolve("@shipvo/mcp/package.json"), "utf8")).version ?? null; } catch { return null; }
}

/** The local file the server entry runs, relative to the app, with `/` separators. The path goes through `node_modules/@shipvo/mcp` (the link), not the real package folder, so it survives upgrades under pnpm. */
export function localServerPath(dir: string): string | null {
  try {
    const req = createRequire(join(dir, "package.json"));
    const pkgDir = dirname(realpathSync(req.resolve("@shipvo/mcp/package.json")));
    const sub = relative(pkgDir, realpathSync(req.resolve("@shipvo/mcp/server")));
    if (sub.startsWith("..")) return null;
    for (let root = dir; ; ) {
      const link = join(root, "node_modules", "@shipvo", "mcp");
      if (existsSync(join(link, "package.json"))) return relative(dir, join(link, sub)).split(sep).join("/");
      const up = dirname(root);
      if (up === root) return null;
      root = up;
    }
  } catch { return null; }
}

/** The `shipvo` server entry. Default: run the installed file with node (no shell, no npm check). `npx`: a pinned npx command. */
export function serverEntry(dir: string, opts: { npx?: boolean; version?: string | null; path?: string | null } = {}): McpServerEntry {
  const env = { PN_SIM: simUrl(dir) };
  if (opts.npx) return { command: "npx", args: ["-y", `@shipvo/mcp@${opts.version ?? installedMcpVersion(dir) ?? "latest"}`.replace(/@latest$/, "")], env };
  return { command: "node", args: [opts.path ?? "node_modules/@shipvo/mcp/dist/server.js"], env };
}

/** The add command per package manager for `@shipvo/mcp` as a dev dependency. */
export function mcpInstallCommand(pm: PackageManager): { cmd: string; args: string[] } {
  switch (pm) {
    case "pnpm": return { cmd: "pnpm", args: ["add", "-D", "@shipvo/mcp"] };
    case "yarn": return { cmd: "yarn", args: ["add", "-D", "@shipvo/mcp"] };
    case "bun": return { cmd: "bun", args: ["add", "-d", "@shipvo/mcp"] };
    default: return { cmd: "npm", args: ["install", "--save-dev", "@shipvo/mcp"] };
  }
}

/** Add the `shipvo` server and keep every other server and key. Returns null if the file is not valid JSON. */
export function mergeMcp(text: string | null, entry: McpServerEntry = serverEntry(process.cwd())): string | null {
  let doc: Record<string, unknown> = {};
  if (text !== null && text.trim()) {
    try { doc = JSON.parse(text); } catch { return null; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  }
  const servers = (doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {}) as Record<string, unknown>;
  servers.shipvo = entry;
  return JSON.stringify({ ...doc, mcpServers: servers }, null, 2) + "\n";
}

/** Where synced skills are copied to, relative to the project. */
export const SKILL_DIRS = [".agents/skills", ".claude/skills"];

export type SkillEntry = { package: string; name: string; source: string };

/** Skills shipped by the `@shipvo/*` packages this project depends on and has installed. */
export function projectSkills(dir: string): SkillEntry[] {
  let deps: Record<string, unknown> = {};
  try {
    const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    deps = { ...p.peerDependencies, ...p.devDependencies, ...p.dependencies };
  } catch { return []; }
  const out: SkillEntry[] = [];
  for (const pkg of Object.keys(deps).filter((d) => d.startsWith("@shipvo/")).sort()) {
    let root = dir, found: string | null = null;
    for (;;) {
      const c = join(root, "node_modules", pkg, "skills");
      if (existsSync(c)) { found = c; break; }
      const up = dirname(root);
      if (up === root) break;
      root = up;
    }
    if (!found) continue;
    for (const n of readdirSync(found).sort()) {
      const source = join(found, n, "SKILL.md");
      if (existsSync(source)) out.push({ package: pkg, name: n, source });
    }
  }
  return out;
}

/** Which skill files (project-relative) are missing or out of date. */
function skillTargets(dir: string, e: SkillEntry): { file: string; text: string; synced: boolean }[] {
  const text = readFileSync(e.source, "utf8");
  return SKILL_DIRS.map((d) => {
    const file = `${d}/${e.name}/SKILL.md`;
    const path = join(dir, file);
    return { file, text, synced: existsSync(path) && readFileSync(path, "utf8") === text };
  });
}

/** For `status --json`: each package skill and whether every target holds the current copy. */
export function skillStatus(dir: string): { package: string; name: string; synced: boolean }[] {
  return projectSkills(dir).map((e) => ({ package: e.package, name: e.name, synced: skillTargets(dir, e).every((t) => t.synced) }));
}

type Change = { file: string; action: "create" | "update" | "unchanged" | "skip"; note?: string };

/** `shipvo agents setup [--dry-run] [--json]`. Exit 0 done, 2 error. */
export async function agentsCmd(argv: string[], dir = process.cwd(), deps: { run?: (cmd: string, args: string[], cwd: string) => void } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "setup" && sub !== "skills-sync") { console.error("Usage: shipvo agents setup [--dry-run] [--json] [--npx]"); return 2; }
  const only = sub === "skills-sync";
  const a = args(rest);
  const dry = a["dry-run"] !== undefined, json = a.json !== undefined;
  const kind = detectProject(dir);
  const changes: Change[] = [];
  const writes: { path: string; text: string }[] = [];
  let installed: string | undefined;
  const plan = (file: string, next: string | null, note?: string) => {
    const path = join(dir, file);
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (next === null) { changes.push({ file, action: "skip", note }); return; }
    if (old === next) { changes.push({ file, action: "unchanged" }); return; }
    changes.push({ file, action: old === null ? "create" : "update" });
    writes.push({ path, text: next });
  };
  const read = (f: string) => existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null;

  if (!only) {
    plan("AGENTS.md", upsertSection(read("AGENTS.md") ?? "", agentsSection(kind)), "AGENTS.md has a broken shipvo marker; fix it and run again.");
    const npx = a.npx !== undefined;
    const hasPkg = existsSync(join(dir, "package.json"));
    let entry: McpServerEntry;
    if (npx) {
      if (installedMcpVersion(dir) === null) { console.error("`--npx` pins the installed @shipvo/mcp version, and none is installed. Install it (`npm install --save-dev @shipvo/mcp`) and run again, or leave out `--npx`."); return 2; }
      entry = serverEntry(dir, { npx: true });
    }
    else {
      if (installedMcpVersion(dir) === null && hasPkg) {
        const pm = detectPackageManager(dir, existsSync);
        const { cmd, args: cargs } = mcpInstallCommand(pm);
        if (dry) installed = `would run ${cmd} ${cargs.join(" ")}`;
        else {
          try { (deps.run ?? ((c, r, d) => { execFileSync(c, r, { cwd: d, stdio: json ? ["ignore", 2, 2] : "inherit", shell: process.platform === "win32" }); }))(cmd, cargs, dir); installed = `${cmd} ${cargs.join(" ")}`; }
          catch { console.error(`Could not run \`${cmd} ${cargs.join(" ")}\`. Run it yourself, or use \`shipvo agents setup --npx\`.`); return 2; }
        }
      }
      entry = serverEntry(dir, { path: localServerPath(dir) });
    }
    const targets = [".mcp.json", ...(existsSync(join(dir, ".cursor")) ? [".cursor/mcp.json"] : [])];
    for (const f of targets) {
      const merged = mergeMcp(read(f), entry);
      plan(f, merged, `${f} is not valid JSON; I left it alone. Fix it and run again.`);
    }
  }
  const skills = projectSkills(dir);
  for (const e of skills) for (const t of skillTargets(dir, e)) plan(t.file, t.text);
  const bad = changes.some((c) => c.action === "skip");
  if (!dry && !bad) for (const w of writes) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.text); }
  const wrote = !dry && !bad;
  if (json) console.log(JSON.stringify({ ok: !bad, project: kind, dry_run: dry, mcp_install: installed ?? null, changes, skill_install: SKILL_LINE, skills: skills.map((e) => ({ package: e.package, name: e.name })) }));
  else {
    console.log(`Project: ${LABEL[kind]}.`);
    if (installed) console.log(`  @shipvo/mcp: ${dry ? installed : `added with ${installed}`}`);
    for (const c of changes) console.log(`  ${c.file}: ${c.action === "skip" ? c.note : c.action === "unchanged" ? "already up to date" : `${dry ? "would " : ""}${c.action}${dry ? "" : "d"}`}`);
    if (dry) console.log("Dry run: nothing was written.");
    else if (wrote && !changes.some((c) => c.action !== "unchanged")) console.log("Nothing to change.");
    if (only && !skills.length) console.log("No installed @shipvo/* dependency ships a skill.");
    if (!only) console.log(`Install the skill: ${SKILL_LINE}`);
  }
  return bad ? 2 : 0;
}
