// `shipvo login`: sign in with GitHub (device flow) and get an API key for the hosted simulator.
// `shipvo keys`: show the stored key's status. `shipvo mcp`: print the MCP config for agents.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { args as parse } from "./config.js";

const HOSTED = "https://purenative-control.purenative.workers.dev";
const credFile = () => join(process.env.SHIPVO_HOME || join(homedir(), ".shipvo"), "credentials.json");
export function savedCreds(): { key: string; control: string; mcp_url: string; login?: string } | null {
  try { return JSON.parse(readFileSync(credFile(), "utf8")); } catch { return null; }
}

export async function login(argv: string[]) {
  const a = parse(argv); const control = (a["control-plane"] || process.env.SHIPVO_CONTROL || HOSTED).replace(/\/$/, "");
  const start = await fetch(`${control}/auth/device/start`, { method: "POST" });
  const s: any = await start.json();
  if (!start.ok) { console.error(`Login is not available on ${control}: ${s.message ?? s.error}`); process.exit(1); }
  console.log(`\nOpen ${s.verification_uri} and enter the code:\n\n    ${s.user_code}\n\nWaiting for GitHub…`);
  const deadline = Date.now() + (s.expires_in ?? 900) * 1000; let interval = (s.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const r = await fetch(`${control}/auth/device/poll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: s.device_code }) });
    const d: any = await r.json();
    if (r.status === 202) { if (d.status === "slow_down") interval += 5000; continue; }
    if (!r.ok) { console.error(`Login failed: ${d.status ?? d.error}`); process.exit(1); }
    mkdirSync(join(credFile(), ".."), { recursive: true });
    writeFileSync(credFile(), JSON.stringify({ key: d.key, control, mcp_url: d.mcp.url, login: d.login, apps: d.apps, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(`\nSigned in as ${d.login}. Key ${d.prefix}… saved to ${credFile()} (quota: ${d.quota_minutes} sandbox minutes; expires ${String(d.expires_at).slice(0, 10)}; apps: ${d.apps.join(", ")}).\n`);
    printMcp(d.mcp.url, d.key);
    return;
  }
  console.error("Timed out waiting for GitHub."); process.exit(1);
}

export async function keys() {
  const c = savedCreds(); if (!c) { console.error("Not signed in. Run `shipvo login`."); process.exit(1); }
  const r = await fetch(`${c.control}/auth/me`, { headers: { authorization: `Bearer ${c.key}` } });
  const d: any = await r.json();
  if (!r.ok) { console.error(d.error === "key_expired" ? `Key ${c.key.slice(0, 12)}… expired on ${d.expires_at}. Run \`shipvo login\` to get a new one.` : `Key ${c.key.slice(0, 12)}… is not valid any more (${d.error}). Run \`shipvo login\`.`); process.exit(1); }
  console.log(JSON.stringify({ login: d.github_login, prefix: d.prefix, scope: d.scope, app: d.app_id, expires_at: d.expires_at, used_minutes: d.used_minutes, quota_minutes: d.quota_minutes, last_used_at: d.last_used_at, mcp_url: c.mcp_url }, null, 2));
}

export function mcp() {
  const c = savedCreds(); if (!c) { console.error("Not signed in. Run `shipvo login`."); process.exit(1); }
  printMcp(c.mcp_url, c.key);
}

function printMcp(url: string, key: string) {
  console.log(`Claude Desktop / Cursor / Claude Code (remote):\n${JSON.stringify({ mcpServers: { shipvo: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)}\n`);
  console.log(`ChatGPT (custom MCP connector, cannot send headers): ${url}/${key}\n`);
  console.log(`Local simulator instead: { "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } } after \`shipvo sim\`.`);
}
