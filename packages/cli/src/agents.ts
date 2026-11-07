import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { args } from "./config.js";
import { detectPackageManager, type PackageManager } from "./ensure-playwright.js";
import { TARGETS, blockFor, detected, mergeJson, mergeToml } from "./agent-targets.js";

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

/** Add the `shipvo` server to a `.mcp.json` style file and keep every other server and key. Returns null if the file is not valid JSON. */
export function mergeMcp(text: string | null, entry: McpServerEntry = serverEntry(process.cwd())): string | null {
  return mergeJson(text, ["mcpServers"], entry);
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
export async function agentsCmd(argv: string[], dir = process.cwd(), home = homedir(), pathVar = process.env.PATH, deps: { run?: (cmd: string, args: string[], cwd: string) => void; creds?: () => { key: string; mcp_url: string } | null; login?: () => Promise<{ key: string; mcp_url: string } | null> } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "setup" && sub !== "skills-sync") { console.error("Usage: shipvo agents setup [--for <names>] [--all] [--global] [--npx] [--hosted] [--dry-run] [--json]"); return 2; }
  const only = sub === "skills-sync";
  const a = args(rest);
  const dry = a["dry-run"] !== undefined, json = a.json !== undefined;
  const kind = detectProject(dir);
  const changes: Change[] = [];
  const writes: { path: string; text: string }[] = [];
  let installed: string | undefined;
  const plan = (file: string, next: string | null, note?: string) => {
    const path = resolve(dir, file);
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (next === null) { changes.push({ file, action: "skip", note }); return; }
    if (old === next) { changes.push({ file, action: "unchanged" }); return; }
    changes.push({ file, action: old === null ? "create" : "update" });
    writes.push({ path, text: next });
  };
  const read = (f: string) => existsSync(resolve(dir, f)) ? readFileSync(resolve(dir, f), "utf8") : null;
  const forced = new Set((a.for ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const unknown = [...forced].filter((n) => !TARGETS.some((t) => t.id === n));
  if (unknown.length) { console.error(`Unknown agent: ${unknown.join(", ")}. Known: ${TARGETS.map((t) => t.id).join(", ")}.`); return 2; }
  const all = a.all !== undefined, global = a.global !== undefined;
  if (a.hosted !== undefined && !only) {
    const { hostedSetup } = await import("./agents-hosted.js");
    const lg = deps.login ?? (async () => { const l = await import("./login.js"); return l.loginForKey(json); });
    const sc = deps.creds ? deps.creds() : (await import("./login.js")).savedCreds();
    return hostedSetup({ dir, home, pathVar, dry, json, all, forced, creds: sc, login: lg });
  }
  type AgentResult = { agent: string; name: string; action: "written" | "up-to-date" | "printed" | "not-found" | "skipped"; file?: string; note?: string; block?: string };
  const agentResults: AgentResult[] = [];
  const homeFile = (f: string) => f.startsWith("~/") ? join(home, f.slice(2)) : f;

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
    for (const t of TARGETS) {
      const on = all || forced.has(t.id) || detected(t, dir, pathVar);
      const base = { agent: t.id, name: t.label };
      if (t.level === "project") {
        if (!on) { agentResults.push({ ...base, action: "not-found", note: `not found; add it with --for ${t.id}` }); continue; }
        const merged = mergeJson(read(t.file), t.jsonPath!, t.entry!(entry));
        const before = changes.length;
        plan(t.file, merged, `${t.file} is not valid JSON (or has an unexpected shape); I left it alone. Fix it and run again.`);
        const c = changes[before];
        agentResults.push({ ...base, file: t.file, action: c.action === "skip" ? "skipped" : c.action === "unchanged" ? "up-to-date" : "written", note: c.note });
        continue;
      }
      // User-level config: written only with --global, otherwise printed to paste.
      const file = homeFile(t.file), block = blockFor(t, entry);
      if (t.level === "user-write" && global && on) {
        const old = read(file);
        const next = t.block ? mergeToml(old, block) : mergeJson(old, t.jsonPath!, t.entry!(entry));
        const before = changes.length;
        plan(file, next, `${file} could not be parsed; I left it alone. Fix it and run again.`);
        const c = changes[before];
        agentResults.push({ ...base, file, action: c.action === "skip" ? "skipped" : c.action === "unchanged" ? "up-to-date" : "written", note: c.note, block });
      } else agentResults.push({ ...base, file, action: "printed", block, note: t.level === "user-write" ? (on ? "run with --global to write it" : `not found; add it with --for ${t.id} --global`) : undefined });
    }
  }
  const skills = projectSkills(dir);
  for (const e of skills) for (const t of skillTargets(dir, e)) plan(t.file, t.text);
  const bad = changes.some((c) => c.action === "skip");
  if (!dry && !bad) for (const w of writes) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.text); }
  const wrote = !dry && !bad;
  if (json) console.log(JSON.stringify({ ok: !bad, project: kind, dry_run: dry, changes, mcp_install: installed ?? null, agents: agentResults, skill_install: SKILL_LINE, skills: skills.map((e) => ({ package: e.package, name: e.name })) }));
  else {
    console.log(`Project: ${LABEL[kind]}.`);
    if (installed) console.log(`  @shipvo/mcp: ${dry ? installed : `added with ${installed}`}`);
    for (const c of changes) console.log(`  ${c.file}: ${c.action === "skip" ? c.note : c.action === "unchanged" ? "already up to date" : `${dry ? "would " : ""}${c.action}${dry ? "" : "d"}`}`);
    if (!only) {
      console.log("Agents:");
      for (const r of agentResults) console.log(`  ${r.name} (${r.agent}): ${r.action === "written" ? (dry ? "would write" : "written") : r.action === "up-to-date" ? "already up to date" : r.action === "skipped" ? r.note : r.action === "not-found" ? r.note : "printed (user-level)"}${r.file && r.action !== "not-found" ? ` [${r.file}]` : ""}`);
      for (const r of agentResults.filter((x) => x.action === "printed" || (x.block && x.action === "written"))) console.log(`\n${r.name}: add this to ${r.file}${r.note ? ` (${r.note})` : ""}\n${r.block}`);
      console.log("");
    }
    if (dry) console.log("Dry run: nothing was written.");
    else if (wrote && !changes.some((c) => c.action !== "unchanged")) console.log("Nothing to change.");
    if (only && !skills.length) console.log("No installed @shipvo/* dependency ships a skill.");
    if (!only) console.log(`Install the skill: ${SKILL_LINE}`);
  }
  return bad ? 2 : 0;
}
