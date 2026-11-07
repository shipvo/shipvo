import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** The Shipvo MCP server: what every agent runs. */
export const SERVER = { command: "npx", args: ["-y", "@shipvo/mcp"] };

export type Level = "project" | "user-write" | "user-print";

export type AgentTarget = {
  /** Name used with `--for`. */
  id: string;
  label: string;
  level: Level;
  /** Config file. Project-relative for "project"; `~/...` for the user level. */
  file: string;
  /** Project folders or files whose presence means the agent is used here. */
  markers?: string[];
  /** CLI on PATH that means the agent is installed. */
  cli?: string;
  /** Always written by default (Claude Code's `.mcp.json` is the shared baseline). */
  always?: boolean;
  /** JSON: key path holding the servers, and the entry shape. */
  jsonPath?: string[];
  entry?: () => unknown;
  /** Text for agents we only print (or merge as text). */
  block?: () => string;
};

const std = () => ({ ...SERVER });
const asJson = (path: string[], entry: unknown) => JSON.stringify(path.reduceRight<unknown>((v, k) => ({ [k]: v }), { shipvo: entry }), null, 2);

/**
 * One table: where each agent reads MCP servers and in what shape.
 * Each format follows the agent's official docs (linked per entry).
 */
export const TARGETS: AgentTarget[] = [
  // https://docs.claude.com/en/docs/claude-code/mcp
  { id: "claude", label: "Claude Code", level: "project", file: ".mcp.json", markers: [".claude", ".mcp.json", "CLAUDE.md"], cli: "claude", always: true, jsonPath: ["mcpServers"], entry: std },
  // https://docs.cursor.com/context/model-context-protocol
  { id: "cursor", label: "Cursor", level: "project", file: ".cursor/mcp.json", markers: [".cursor"], jsonPath: ["mcpServers"], entry: std },
  // https://code.visualstudio.com/docs/copilot/customization/mcp-servers
  { id: "vscode", label: "VS Code / GitHub Copilot", level: "project", file: ".vscode/mcp.json", markers: [".vscode", ".github/copilot-instructions.md"], jsonPath: ["servers"], entry: () => ({ type: "stdio", ...SERVER }) },
  // https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
  { id: "gemini", label: "Gemini CLI", level: "project", file: ".gemini/settings.json", markers: [".gemini", "GEMINI.md"], cli: "gemini", jsonPath: ["mcpServers"], entry: std },
  // https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/
  { id: "qwen", label: "Qwen Code", level: "project", file: ".qwen/settings.json", markers: [".qwen", "QWEN.md"], cli: "qwen", jsonPath: ["mcpServers"], entry: std },
  // https://docs.roocode.com/features/mcp/using-mcp-in-roo
  { id: "roo", label: "Roo Code", level: "project", file: ".roo/mcp.json", markers: [".roo", ".roomodes"], jsonPath: ["mcpServers"], entry: std },
  // https://kiro.dev/docs/mcp/configuration/
  { id: "kiro", label: "Kiro", level: "project", file: ".kiro/settings/mcp.json", markers: [".kiro"], jsonPath: ["mcpServers"], entry: std },
  // https://opencode.ai/docs/mcp-servers/
  { id: "opencode", label: "opencode", level: "project", file: "opencode.json", markers: ["opencode.json", ".opencode"], cli: "opencode", jsonPath: ["mcp"], entry: () => ({ type: "local", command: [SERVER.command, ...SERVER.args], environment: {} }) },
  // https://developers.openai.com/codex/mcp
  { id: "codex", label: "Codex CLI", level: "user-write", file: "~/.codex/config.toml", cli: "codex", block: () => codexBlock() },
  // https://docs.windsurf.com/windsurf/cascade/mcp
  { id: "windsurf", label: "Windsurf", level: "user-write", file: "~/.codeium/windsurf/mcp_config.json", markers: [".windsurf"], jsonPath: ["mcpServers"], entry: std },
  // https://modelcontextprotocol.io/quickstart/user
  { id: "claude-desktop", label: "Claude Desktop", level: "user-print", file: "claude_desktop_config.json (Settings > Developer > Edit Config)", jsonPath: ["mcpServers"], entry: std },
  // https://docs.cline.bot/mcp/configuring-mcp-servers
  { id: "cline", label: "Cline", level: "user-print", file: "cline_mcp_settings.json (MCP Servers > Configure)", jsonPath: ["mcpServers"], entry: std },
  // https://zed.dev/docs/ai/mcp
  { id: "zed", label: "Zed", level: "user-print", file: "Zed settings.json", jsonPath: ["context_servers"], entry: () => ({ source: "custom", ...SERVER }) },
  // https://block.github.io/goose/docs/getting-started/using-extensions
  { id: "goose", label: "Goose", level: "user-print", file: "~/.config/goose/config.yaml", cli: "goose", block: () => `extensions:\n  shipvo:\n    name: shipvo\n    type: stdio\n    cmd: ${SERVER.command}\n    args:\n      - ${SERVER.args.join("\n      - ")}\n    enabled: true\n    timeout: 300` },
  // https://docs.continue.dev/customize/deep-dives/mcp
  { id: "continue", label: "Continue", level: "user-print", file: ".continue/mcpServers/shipvo.yaml", block: () => `name: Shipvo\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: shipvo\n    command: ${SERVER.command}\n    args:\n      - ${SERVER.args.join("\n      - ")}` },
  // https://ampcode.com/manual#mcp
  { id: "amp", label: "Amp", level: "user-print", file: "Amp settings.json", jsonPath: ["amp.mcpServers"], entry: std },
];

const tomlStr = (s: string) => JSON.stringify(s);
export function codexBlock(): string {
  return `[mcp_servers.shipvo]\ncommand = ${tomlStr(SERVER.command)}\nargs = [${SERVER.args.map(tomlStr).join(", ")}]\nenv = {}\n`;
}

/** The block to paste for a print-only or text-merged agent. */
export function blockFor(t: AgentTarget): string {
  return t.block ? t.block() : asJson(t.jsonPath!, t.entry!());
}

/** Add the Shipvo entry under the key `path[0]` and keep every other server and key. Returns null if the text is not a JSON object. */
export function mergeJson(text: string | null, path: string[], entry: unknown): string | null {
  let doc: Record<string, unknown> = {};
  if (text !== null && text.trim()) {
    try { doc = JSON.parse(text); } catch { return null; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  }
  // The path is one key (`amp.mcpServers` is a single flat key).
  const key = path[0];
  const cur = doc[key];
  if (cur !== undefined && (cur === null || typeof cur !== "object" || Array.isArray(cur))) return null;
  return JSON.stringify({ ...doc, [key]: { ...(cur as object | undefined), shipvo: entry } }, null, 2) + "\n";
}

/** Put `[mcp_servers.shipvo]` into TOML text. Replaces our table (and its sub-tables) in place; touches no other table. */
export function mergeToml(text: string | null, block: string): string {
  const src = text ?? "";
  const lines = src.split("\n");
  const own = /^\s*\[\s*mcp_servers\s*\.\s*"?shipvo"?\s*(\.[^\]]*)?\]\s*(#.*)?$/;
  const header = /^\s*\[/;
  const out: string[] = [];
  let skipping = false, placed = false;
  for (const line of lines) {
    if (header.test(line)) {
      skipping = own.test(line);
      if (skipping && !placed) { out.push(...block.trimEnd().split("\n"), ""); placed = true; }
    }
    if (!skipping) out.push(line);
  }
  let res = out.join("\n");
  if (!placed) res = (src.trim() ? src.replace(/\n*$/, "\n\n") : "") + block;
  return res.replace(/\n*$/, "\n");
}

export function onPath(cli: string, pathVar = process.env.PATH ?? ""): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  return pathVar.split(delimiter).some((d) => d && exts.some((e) => existsSync(join(d, cli + e))));
}

/** Is this agent used in `dir`? Its folder or file exists, or its CLI is on PATH. */
export function detected(t: AgentTarget, dir: string, pathVar?: string): boolean {
  return !!t.always || !!t.markers?.some((m) => existsSync(join(dir, m))) || (!!t.cli && onPath(t.cli, pathVar));
}
