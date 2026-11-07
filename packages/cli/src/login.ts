// `shipvo login`: sign in with GitHub (device flow) and get an API key for the hosted simulator.
// `shipvo keys`: show the stored key's status. `shipvo mcp`: print the MCP config for agents.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { args as parse } from "./config.js";
import { serverEntry, localServerPath } from "./agents.js";
import { CliFailure, runJson, type Done } from "./json-out.js";

const HOSTED = "https://api.shipvo.dev";
const credFile = () => join(process.env.SHIPVO_HOME || join(homedir(), ".shipvo"), "credentials.json");
export function savedCreds(): { key: string; control: string; mcp_url: string; login?: string } | null {
  try { return JSON.parse(readFileSync(credFile(), "utf8")); } catch { return null; }
}

export async function login(argv: string[]) {
  if (argv.includes("--json")) return runJson(() => loginRun(argv, true), [{ command: "shipvo login --json", why: "Try signing in again." }, { command: "shipvo doctor --json", why: "Check your setup." }]);
  await loginRun(argv, false);
}

/** Device sign-in. With `json`, failures throw (the envelope reports them), the device URL and code go in `data`, and the key is never printed. */
async function loginRun(argv: string[], json: boolean): Promise<Done> {
  const again = [{ command: "shipvo login --json", why: "Start a new sign-in." }];
  const fail = (msg: string, code: string): never => {
    if (json) throw new CliFailure(msg, code, 1, again);
    console.error(msg); process.exit(1);
  };
  const a = parse(argv); const control = (a["control-plane"] || process.env.SHIPVO_CONTROL || HOSTED).replace(/\/$/, "");
  const start = await fetch(`${control}/auth/device/start`, { method: "POST" });
  const s: any = await start.json();
  if (!start.ok) fail(`Login is not available on ${control}: ${s.message ?? s.error}`, "login_unavailable");
  console.log(`\nOpen ${s.verification_uri} and enter the code:\n\n    ${s.user_code}\n\nWaiting for GitHub…`);
  const deadline = Date.now() + (s.expires_in ?? 900) * 1000; let interval = (s.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const r = await fetch(`${control}/auth/device/poll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: s.device_code }) });
    const d: any = await r.json();
    if (r.status === 202) { if (d.status === "slow_down") interval += 5000; continue; }
    if (!r.ok) fail(`Login failed: ${d.status ?? d.error}`, d.status === "expired_token" || d.status === "expired" ? "login_expired" : "login_failed");
    mkdirSync(join(credFile(), ".."), { recursive: true });
    writeFileSync(credFile(), JSON.stringify({ key: d.key, control, mcp_url: d.mcp.url, login: d.login, apps: d.apps, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    if (json) {
      return {
        code: "signed_in", summary: `Signed in as ${d.login}. The key is saved to ${credFile()}.`,
        data: { login: d.login, key_prefix: d.prefix, saved_to: credFile(), quota_minutes: d.quota_minutes, expires_at: d.expires_at, apps: d.apps, mcp_url: d.mcp.url, device: { verification_uri: s.verification_uri, user_code: s.user_code } },
        next: [{ command: "shipvo app create", why: "Register the app and save a publish token." }, { command: "shipvo doctor --json", why: "Check the setup." }],
      };
    }
    console.log(`\nSigned in as ${d.login}. Key ${d.prefix}… saved to ${credFile()} (quota: ${d.quota_minutes} sandbox minutes; expires ${String(d.expires_at).slice(0, 10)}; apps: ${d.apps.join(", ")}).\n`);
    printMcp(d.mcp.url, d.key);
    return { code: "signed_in", summary: "", data: {}, next: [] };
  }
  return fail("Timed out waiting for GitHub.", "login_timeout");
}

/** Sign in for `shipvo agents setup --hosted`. Prints the device code, never the key. With `quiet`, prints go to stderr so JSON output stays clean. */
export async function loginForKey(quiet = false): Promise<{ key: string; mcp_url: string } | null> {
  const log = console.log;
  if (quiet) console.log = (...x: unknown[]) => console.error(...x);
  try { await loginRun([], true); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return null; } finally { console.log = log; }
  return savedCreds();
}

export async function keys() {
  const c = savedCreds(); if (!c) { console.error("Not signed in. Run `shipvo login`."); process.exit(1); }
  const r = await fetch(`${c.control}/auth/me`, { headers: { authorization: `Bearer ${c.key}` } });
  const d: any = await r.json();
  if (!r.ok) { console.error(d.error === "key_expired" ? `Key ${c.key.slice(0, 12)}… expired on ${d.expires_at}. Run \`shipvo login\` to get a new one.` : `Key ${c.key.slice(0, 12)}… is not valid any more (${d.error}). Run \`shipvo login\`.`); process.exit(1); }
  console.log(JSON.stringify({ login: d.github_login, prefix: d.prefix, scope: d.scope, app: d.app_id, expires_at: d.expires_at, used_minutes: d.used_minutes, quota_minutes: d.quota_minutes, last_used_at: d.last_used_at, mcp_url: c.mcp_url }, null, 2));
}

export function mcp() {
  const c = savedCreds();
  if (!c) { printLocalMcp(); console.log("\nTo let agents open your published app from anywhere, run `shipvo login` for a hosted config."); return; }
  printMcp(c.mcp_url, c.key);
}

function printLocalMcp() { console.log(`Local simulator (no login needed). Run \`npm run sim\` first (\`shipvo agents setup\` adds @shipvo/mcp and writes this for you):\n${JSON.stringify({ mcpServers: { shipvo: serverEntry(process.cwd(), { path: localServerPath(process.cwd()) }) } }, null, 2)}`); }

function printMcp(url: string, key: string) {
  console.log(`Claude Desktop / Cursor / Claude Code (remote):\n${JSON.stringify({ mcpServers: { shipvo: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)}\n`);
  console.log(`ChatGPT (custom MCP connector, cannot send headers): ${url}/${key}\n`);
  console.log(`Local simulator instead (after \`shipvo sim\`): ${JSON.stringify({ mcpServers: { shipvo: serverEntry(process.cwd(), { path: localServerPath(process.cwd()) }) } })}`);
}
