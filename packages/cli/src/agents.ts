// `shipvo agents setup`: tell coding agents how to use Shipvo in this project.
// Writes a marked section in AGENTS.md and adds @shipvo/mcp to .mcp.json (and .cursor/mcp.json). Idempotent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BEGIN = "<!-- shipvo:begin -->";
export const END = "<!-- shipvo:end -->";
export const SKILL_LINE = "npx skills add shipvo/shipvo --skill shipvo -g";

export type ProjectKind = "shipvo" | "expo" | "react-native" | "capacitor" | "unknown";

/** What kind of project this folder is. A shipvo.json wins; then Capacitor, Expo, bare React Native. */
export function detectProject(dir: string): ProjectKind {
  if (existsSync(join(dir, "shipvo.json"))) return "shipvo";
  let pkg: any = {};
  try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { /* none */ }
  const has = (n: string) => Boolean(pkg.dependencies?.[n] ?? pkg.devDependencies?.[n]);
  if (existsSync(join(dir, "capacitor.config.ts")) || existsSync(join(dir, "capacitor.config.json")) || has("@capacitor/core")) return "capacitor";
  if (has("expo")) return "expo";
  if (has("react-native")) return "react-native";
  return "unknown";
}

export function agentsSection(kind: ProjectKind): string {
  const lines = [
    BEGIN,
    "## Shipvo",
    "",
    `This project uses Shipvo (${kind === "unknown" ? "project type not detected" : `detected: ${kind}`}). Use \`shipvo\` commands instead of hand-written scripts.`,
    "",
    "- When you are unsure what to do next, run `npx -y @shipvo/cli status --json`. It lists the next commands to run.",
    "- Run `npx -y @shipvo/cli doctor` to check the setup before a first publish.",
    "- Drive the app with the `shipvo` MCP server (`@shipvo/mcp`, see `.mcp.json`).",
    `- Install the skill: \`${SKILL_LINE}\``,
    END,
  ];
  return lines.join("\n");
}

/** Replace the marked section, or append it. Text outside the markers is never changed. */
export function updateAgentsMd(existing: string | null, section: string): string {
  if (existing === null || existing === "") return section + "\n";
  const b = existing.indexOf(BEGIN);
  const e = b === -1 ? -1 : existing.indexOf(END, b);
  if (b !== -1 && e !== -1) return existing.slice(0, b) + section + existing.slice(e + END.length);
  return existing.replace(/\n*$/, "\n\n") + section + "\n";
}

const SERVER = { command: "npx", args: ["-y", "@shipvo/mcp"] };

/** Add the shipvo server; keep every other server and key. Returns null when the file has invalid JSON. */
export function mergeMcp(existing: string | null): string | null {
  let doc: any = {};
  if (existing !== null && existing.trim() !== "") { try { doc = JSON.parse(existing); } catch { return null; } }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const servers = doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {};
  doc.mcpServers = { ...servers, shipvo: servers.shipvo ?? SERVER };
  return JSON.stringify(doc, null, 2) + "\n";
}

type FileResult = { path: string; action: "created" | "updated" | "unchanged" | "skipped"; reason?: string };

function apply(dir: string, rel: string, make: (old: string | null) => string | null, dry: boolean): FileResult {
  const p = join(dir, rel);
  const old = existsSync(p) ? readFileSync(p, "utf8") : null;
  const next = make(old);
  if (next === null) return { path: rel, action: "skipped", reason: "not valid JSON; fix it by hand and run again" };
  if (next === old) return { path: rel, action: "unchanged" };
  if (!dry) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, next); }
  return { path: rel, action: old === null ? "created" : "updated" };
}

export function agentsSetup(argv: string[], dir = process.cwd()): number {
  const sub = argv[0];
  if (sub !== "setup") { console.error("Usage: shipvo agents setup [--dry-run] [--json]"); return 2; }
  const dry = argv.includes("--dry-run"), json = argv.includes("--json");
  const kind = detectProject(dir);
  const files = [
    apply(dir, "AGENTS.md", (o) => updateAgentsMd(o, agentsSection(kind)), dry),
    apply(dir, ".mcp.json", mergeMcp, dry),
  ];
  if (existsSync(join(dir, ".cursor"))) files.push(apply(dir, ".cursor/mcp.json", mergeMcp, dry));
  const skipped = files.some((f) => f.action === "skipped");
  if (json) {
    console.log(JSON.stringify({ ok: !skipped, dry_run: dry, project: kind, files, skill: SKILL_LINE }, null, 2));
  } else {
    console.log(`Project: ${kind}${dry ? " (dry run, nothing written)" : ""}`);
    for (const f of files) console.log(`  ${f.path}: ${f.action}${f.reason ? ` (${f.reason})` : ""}`);
    console.log(`\nInstall the skill:\n  ${SKILL_LINE}`);
  }
  return skipped ? 1 : 0;
}
