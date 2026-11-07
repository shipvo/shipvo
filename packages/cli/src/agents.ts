import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { args } from "./config.js";
import { setupHosted } from "./agents-hosted.js";
import { login, savedCreds } from "./login.js";

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

const SERVER = { command: "npx", args: ["-y", "@shipvo/mcp"] };

/** Add the `shipvo` server and keep every other server and key. Returns null if the file is not valid JSON. */
export function mergeMcp(text: string | null): string | null {
  let doc: Record<string, unknown> = {};
  if (text !== null && text.trim()) {
    try { doc = JSON.parse(text); } catch { return null; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  }
  const servers = (doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {}) as Record<string, unknown>;
  servers.shipvo = SERVER;
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
export type HostedDeps = { home?: string; creds?: typeof savedCreds; login?: (argv: string[]) => Promise<unknown> };

export async function agentsCmd(argv: string[], dir = process.cwd(), deps: HostedDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "setup" && sub !== "skills-sync") { console.error("Usage: shipvo agents setup [--hosted [--agent <name>]] [--dry-run] [--json]"); return 2; }
  const only = sub === "skills-sync";
  const a = args(rest);
  const dry = a["dry-run"] !== undefined, json = a.json !== undefined;
  if (a.hosted !== undefined && !only) return hostedCmd(dir, a, dry, json, deps);
  const kind = detectProject(dir);
  const changes: Change[] = [];
  const writes: { path: string; text: string }[] = [];
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
    const targets = [".mcp.json", ...(existsSync(join(dir, ".cursor")) ? [".cursor/mcp.json"] : [])];
    for (const f of targets) {
      const merged = mergeMcp(read(f));
      plan(f, merged, `${f} is not valid JSON; I left it alone. Fix it and run again.`);
    }
  }
  const skills = projectSkills(dir);
  for (const e of skills) for (const t of skillTargets(dir, e)) plan(t.file, t.text);
  const bad = changes.some((c) => c.action === "skip");
  if (!dry && !bad) for (const w of writes) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.text); }
  const wrote = !dry && !bad;
  if (json) console.log(JSON.stringify({ ok: !bad, project: kind, dry_run: dry, changes, skill_install: SKILL_LINE, skills: skills.map((e) => ({ package: e.package, name: e.name })) }));
  else {
    console.log(`Project: ${LABEL[kind]}.`);
    for (const c of changes) console.log(`  ${c.file}: ${c.action === "skip" ? c.note : c.action === "unchanged" ? "already up to date" : `${dry ? "would " : ""}${c.action}${dry ? "" : "d"}`}`);
    if (dry) console.log("Dry run: nothing was written.");
    else if (wrote && !changes.some((c) => c.action !== "unchanged")) console.log("Nothing to change.");
    if (only && !skills.length) console.log("No installed @shipvo/* dependency ships a skill.");
    if (!only) console.log(`Install the skill: ${SKILL_LINE}`);
  }
  return bad ? 2 : 0;
}

/** `--hosted`: write the remote form for each agent. Signs in first when there is no key yet. */
async function hostedCmd(dir: string, a: Record<string, string | undefined>, dry: boolean, json: boolean, deps: HostedDeps): Promise<number> {
  const creds = deps.creds ?? savedCreds;
  let c = creds();
  if (!c) {
    if (dry) { console.error("Not signed in. Run `shipvo login` first (a dry run does not sign in)."); return 2; }
    await (deps.login ?? login)([]);
    c = creds();
  }
  if (!c) { console.error("Sign-in did not finish, so no key was written. Run `shipvo login`."); return 2; }
  const res = setupHosted({ dir, home: deps.home, url: c.mcp_url, key: c.key, dry, only: a.agent && a.agent !== "true" ? a.agent : undefined });
  const bad = res.some((r) => r.action === "skip");
  if (json) console.log(JSON.stringify({ ok: !bad, hosted: true, dry_run: dry, url: c.mcp_url, changes: res.map((r) => ({ agent: r.agent, file: r.file, action: r.action, reason: r.reason })) }));
  else {
    for (const r of res) {
      if (r.action === "print") console.log(`${r.agent}: not written. ${r.reason}\n${r.block}\n`);
      else if (r.action === "skip") console.log(`${r.agent}: ${r.reason}`);
      else console.log(`${r.agent}: ${r.file} ${r.action === "unchanged" ? "already up to date" : `${dry ? "would " : ""}${r.action}${dry ? "" : "d"}`}`);
    }
    console.log(`Claude Code can also sign in without a key: claude mcp add --transport http shipvo ${c.mcp_url}`);
    if (dry) console.log("Dry run: nothing was written.");
  }
  return bad ? 2 : 0;
}
