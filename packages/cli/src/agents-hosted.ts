// `shipvo agents setup --hosted`: connect each agent to the hosted MCP server (sim.shipvo.dev) with the
// signed-in key. A key goes only into a user-level file, or into a project file that git ignores.
// Anything else is printed, with the reason.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Form = "claude" | "cursor" | "vscode" | "windsurf" | "path";
export type AgentTarget = { agent: string; form: Form; file?: string; scope?: "project" | "user"; detect?: string };

/** One row per agent: which file it reads and how it spells a remote server. `path` agents cannot send headers. */
export const HOSTED_AGENTS: AgentTarget[] = [
  { agent: "Claude Code", form: "claude", file: ".mcp.json", scope: "project" },
  { agent: "Cursor", form: "cursor", file: ".cursor/mcp.json", scope: "project", detect: ".cursor" },
  { agent: "Cursor", form: "cursor", file: ".cursor/mcp.json", scope: "user", detect: ".cursor" },
  { agent: "VS Code", form: "vscode", file: ".vscode/mcp.json", scope: "project", detect: ".vscode" },
  { agent: "Windsurf", form: "windsurf", file: ".codeium/windsurf/mcp_config.json", scope: "user", detect: ".codeium/windsurf" },
  { agent: "ChatGPT", form: "path" },
];

/** The JSON a file-based agent expects. */
export function hostedEntry(form: Exclude<Form, "path">, url: string, key: string): Record<string, unknown> {
  const headers = { Authorization: `Bearer ${key}` };
  switch (form) {
    case "claude": return { mcpServers: { shipvo: { type: "http", url, headers } } };
    case "cursor": return { mcpServers: { shipvo: { url, headers } } };
    case "vscode": return { servers: { shipvo: { type: "http", url, headers } } };
    case "windsurf": return { mcpServers: { shipvo: { serverUrl: url, headers } } };
  }
}

/** Put the shipvo server into an existing config and keep every other key. Null when the text is not a JSON object. */
export function mergeHosted(text: string | null, form: Exclude<Form, "path">, url: string, key: string): string | null {
  let doc: Record<string, any> = {};
  if (text !== null && text.trim()) {
    try { doc = JSON.parse(text); } catch { return null; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  }
  const add = hostedEntry(form, url, key);
  const top = Object.keys(add)[0];
  const servers = doc[top] && typeof doc[top] === "object" && !Array.isArray(doc[top]) ? doc[top] : {};
  servers.shipvo = (add[top] as any).shipvo;
  return JSON.stringify({ ...doc, [top]: servers }, null, 2) + "\n";
}

/** Whether git ignores `file` (checked in `dir`). Not a git repo, or git missing: false, so the key is not written. */
export function gitIgnores(dir: string, file: string): boolean {
  try { execFileSync("git", ["check-ignore", "-q", "--", file], { cwd: dir, stdio: "ignore" }); return true; } catch { return false; }
}
/** Whether git tracks `file`. */
export function gitTracks(dir: string, file: string): boolean {
  try { execFileSync("git", ["ls-files", "--error-unmatch", "--", file], { cwd: dir, stdio: "ignore" }); return true; } catch { return false; }
}

export type HostedResult = { agent: string; file?: string; action: "create" | "update" | "unchanged" | "print" | "skip"; reason?: string; block?: string };

export type HostedOpts = { dir: string; home?: string; url: string; key: string; dry: boolean; only?: string };

/** Plan and (unless dry) write the hosted config for every agent that is present. */
export function setupHosted(o: HostedOpts): HostedResult[] {
  const home = o.home ?? homedir();
  const out: HostedResult[] = [];
  for (const t of HOSTED_AGENTS) {
    if (o.only && t.agent.toLowerCase().replace(/\s+/g, "-") !== o.only.toLowerCase()) continue;
    if (t.form === "path") {
      out.push({ agent: t.agent, action: "print", reason: "ChatGPT connectors cannot send headers, so the key is part of the URL. Treat that URL as a secret.", block: `${o.url}/${o.key}` });
      continue;
    }
    const base = t.scope === "user" ? home : o.dir;
    if (t.detect && !existsSync(join(base, t.detect))) continue;
    const path = join(base, t.file!);
    const shown = t.scope === "user" ? `~/${t.file}` : t.file!;
    const next = mergeHosted(existsSync(path) ? readFileSync(path, "utf8") : null, t.form, o.url, o.key);
    const block = JSON.stringify(hostedEntry(t.form, o.url, o.key), null, 2);
    if (next === null) { out.push({ agent: t.agent, file: shown, action: "skip", reason: `${shown} is not valid JSON; I left it alone.` }); continue; }
    if (t.scope === "project") {
      const tracked = gitTracks(o.dir, t.file!);
      if (tracked || !gitIgnores(o.dir, t.file!)) {
        out.push({ agent: t.agent, file: shown, action: "print", block, reason: tracked ? `${shown} is tracked by git, so a key would be committed. Put this in it by hand, or in your user-level config.` : `${shown} is not git-ignored, so a key could be committed. Add it to .gitignore and run again, or put this in it by hand.` });
        continue;
      }
    }
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (old === next) { out.push({ agent: t.agent, file: shown, action: "unchanged" }); continue; }
    if (!o.dry) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, next, { mode: 0o600 }); }
    out.push({ agent: t.agent, file: shown, action: old === null ? "create" : "update" });
  }
  return out;
}
