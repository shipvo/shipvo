// `shipvo agents setup`: tell coding agents how to drive this project (AGENTS.md section, MCP config).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ProjectKind = "shipvo" | "expo" | "react-native" | "capacitor" | "unknown";

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** Which kind of app lives in `dir`. A shipvo.json wins; then Capacitor, Expo, bare React Native. */
export function detectProject(dir: string): ProjectKind {
  if (existsSync(join(dir, "shipvo.json"))) return "shipvo";
  const pkg = readJson(join(dir, "package.json"));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (["capacitor.config.ts", "capacitor.config.json", "capacitor.config.js"].some((f) => existsSync(join(dir, f))) || deps["@capacitor/core"]) return "capacitor";
  if (deps.expo || existsSync(join(dir, "app.json")) && readJson(join(dir, "app.json"))?.expo) return "expo";
  if (deps["react-native"]) return "react-native";
  return "unknown";
}

export const AGENTS_BEGIN = "<!-- shipvo:agents:begin -->";
export const AGENTS_END = "<!-- shipvo:agents:end -->";
export const SKILL_LINE = "npx skills add shipvo/shipvo --skill shipvo -g";

const LABEL: Record<ProjectKind, string> = { shipvo: "a Shipvo app", expo: "an Expo app", "react-native": "a bare React Native app", capacitor: "a Capacitor app", unknown: "an app" };

/** The text between our markers (markers included). */
export function agentsSection(kind: ProjectKind): string {
  return [
    AGENTS_BEGIN,
    "## Shipvo",
    "",
    `This project is ${LABEL[kind]} that uses Shipvo. Use \`shipvo\` commands instead of ad-hoc scripts.`,
    "",
    "- Not sure what to do next? Run `shipvo status --json`. It lists `next` commands, each with a reason. Exit code 0 means nothing to do, 1 means action needed, 2 means an error.",
    "- Run and check the app in the simulator: `shipvo run android` or `shipvo run ios`, and `shipvo test`.",
    "- Check a release before you ship it: `shipvo publish --dry-run`.",
    "- Never print or commit signing seeds, tokens or `.env` files.",
    "- The simulator is also available over MCP (`@shipvo/mcp`, see `.mcp.json`).",
    AGENTS_END,
  ].join("\n");
}

/** Insert or replace our marked section; text outside the markers is never changed. */
export function applyAgentsSection(existing: string | null, section: string): string {
  if (existing === null || existing.trim() === "") return `# AGENTS.md\n\n${section}\n`;
  const b = existing.indexOf(AGENTS_BEGIN);
  const e = b >= 0 ? existing.indexOf(AGENTS_END, b) : -1;
  if (b >= 0 && e >= 0) return existing.slice(0, b) + section + existing.slice(e + AGENTS_END.length);
  return existing + (existing.endsWith("\n") ? "\n" : "\n\n") + section + "\n";
}

const MCP_ENTRY = { command: "npx", args: ["-y", "@shipvo/mcp"] };

/** Add the shipvo server to an MCP config file's text. Other servers and keys stay. Throws on invalid JSON. */
export function mergeMcpConfig(existing: string | null): string {
  let cfg: any = {};
  if (existing !== null && existing.trim() !== "") {
    cfg = JSON.parse(existing);
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("not a JSON object");
  }
  if (cfg.mcpServers !== undefined && (typeof cfg.mcpServers !== "object" || cfg.mcpServers === null)) throw new Error('"mcpServers" is not an object');
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), shipvo: MCP_ENTRY };
  return JSON.stringify(cfg, null, 2) + "\n";
}

type FileResult = { path: string; action: "created" | "updated" | "unchanged" | "error"; error?: string };

function plan(dir: string, rel: string, make: (old: string | null) => string, dry: boolean): FileResult {
  const path = join(dir, rel);
  const old = existsSync(path) ? readFileSync(path, "utf8") : null;
  let text: string;
  try { text = make(old); } catch (e) { return { path: rel, action: "error", error: `${rel} is not valid: ${e instanceof Error ? e.message : String(e)}. Fix it by hand; nothing was changed in it.` }; }
  if (text === old) return { path: rel, action: "unchanged" };
  if (!dry) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
  return { path: rel, action: old === null ? "created" : "updated" };
}

export async function agentsCmd(argv: string[], dir = process.cwd()): Promise<number> {
  const root = resolve(dir);
  if (argv[0] !== "setup") { console.error("Usage: shipvo agents setup [--dry-run] [--json]"); return 2; }
  const dry = argv.includes("--dry-run"), json = argv.includes("--json");
  const kind = detectProject(root);
  const files: FileResult[] = [
    plan(root, "AGENTS.md", (o) => applyAgentsSection(o, agentsSection(kind)), dry),
    plan(root, ".mcp.json", mergeMcpConfig, dry),
    ...(existsSync(join(root, ".cursor")) ? [plan(root, ".cursor/mcp.json", mergeMcpConfig, dry)] : []),
  ];
  const failed = files.some((f) => f.action === "error");
  if (json) {
    console.log(JSON.stringify({ ok: !failed, code: failed ? "invalid_file" : "ok", dry_run: dry, project: kind, files, skill_install: SKILL_LINE }, null, 2));
  } else {
    console.log(`Project: ${LABEL[kind]}.`);
    for (const f of files) console.log(f.action === "error" ? `  error      ${f.error}` : `  ${(dry && f.action !== "unchanged" ? `would be ${f.action}` : f.action).padEnd(10)} ${f.path}`);
    if (dry) console.log("Dry run: nothing was written.");
    console.log(`\nInstall the skill for your coding agent:\n  ${SKILL_LINE}`);
  }
  return failed ? 2 : 0;
}
