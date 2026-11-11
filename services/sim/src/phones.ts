// Which E2B sandbox (phone pool) a request goes to, and keeping it alive.
//
// - One pool per GitHub account: every assistant the person signs in (ChatGPT, Gemini, Claude) sees the same phones.
//   A key with no account (an app key) keeps its own pool.
// - Idle pools pause instead of being deleted (E2B keeps memory, running processes and files), and the next call
//   resumes them: phones, open apps and the apps' mock backends are where they were.
// - A pool built by an older deploy is replaced, so its tools match the ones the Worker lists.

export type PhonesEnv = {
  DB: D1Database; E2B_API_KEY?: string; E2B_TEMPLATE?: string; E2B_API?: string; E2B_SANDBOX_DOMAIN?: string;
  SESSION_TIMEOUT_S?: string; SIM_REV?: string; OWNER_TOKEN?: string;
};
export class QuotaError extends Error { constructor(public quota: number, public used: number) { super(`quota exhausted: ${used}/${quota} sandbox minutes used`); } }

const api = (env: PhonesEnv) => (env.E2B_API ?? "https://api.e2b.app").replace(/\/$/, "");
const timeoutOf = (env: PhonesEnv) => Number(env.SESSION_TIMEOUT_S ?? 1800);
async function e2b(env: PhonesEnv, method: string, path: string, body?: unknown) {
  const r = await fetch(`${api(env)}${path}`, { method, headers: { "X-API-Key": env.E2B_API_KEY!, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw Object.assign(new Error(`e2b ${method} ${path}: ${r.status} ${text.slice(0, 200)}`), { status: r.status });
  return data;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function healthy(host: string, ms = 4000) { try { return (await fetch(`${host}/health`, { signal: AbortSignal.timeout(ms) })).ok; } catch { return false; } }
async function ready(host: string, tries: number, gapMs: number) { for (let i = 0; i < tries; i++) { if (await healthy(host)) return true; await wait(gapMs); } return false; }

async function newSandbox(env: PhonesEnv, app: string, scope: string, gapMs: number) {
  // autoPause: on idle the sandbox pauses (memory and files kept) instead of being deleted.
  const body = { templateID: env.E2B_TEMPLATE ?? "shipvo-sim", timeout: timeoutOf(env), metadata: { app, scope, by: "sim.shipvo.dev" } };
  // If the E2B plan refuses auto-pause, start the sandbox the old way (deleted on idle) rather than fail.
  const d = await e2b(env, "POST", "/sandboxes", { ...body, autoPause: true }).catch((e: any) => e?.status === 400 || e?.status === 403 ? e2b(env, "POST", "/sandboxes", body) : Promise.reject(e));
  const id: string = d.sandboxID ?? d.sandboxId; const domain: string = d.domain ?? env.E2B_SANDBOX_DOMAIN ?? "e2b.app";
  const host = `https://8787-${id}.${domain}`;
  if (await ready(host, 60, gapMs)) return { id, host };   // Chromium boot
  throw new Error("sandbox did not become ready");
}
const killSandbox = (env: PhonesEnv, id: string) => e2b(env, "DELETE", `/sandboxes/${id}`).catch(() => {});
const touchSandbox = (env: PhonesEnv, id: string) => e2b(env, "POST", `/sandboxes/${id}/timeout`, { timeout: timeoutOf(env) }).catch(() => {});
/** Resumes a paused sandbox. False when E2B no longer has it. */
async function resumeSandbox(env: PhonesEnv, id: string, host: string, gapMs: number) {
  try { await e2b(env, "POST", `/v2/sandboxes/${id}/connect`, { timeout: timeoutOf(env) }); } catch (e: any) { if (e?.status === 404) return false; throw e; }
  return ready(host, 30, gapMs);
}

// Moving phones between sandboxes. Each sandbox is claimed once, right after it starts, with a token derived from a
// Worker secret and the sandbox id, so only this Worker can export or import its phones.
const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const tokenFor = (env: PhonesEnv, id: string) => hex(`${env.OWNER_TOKEN ?? env.E2B_API_KEY ?? ""}:phones:${id}`);
async function phonesCall(env: PhonesEnv, id: string, host: string, path: string, body?: unknown) {
  const r = await fetch(`${host}${path}`, { method: "POST", headers: { authorization: `Bearer ${await tokenFor(env, id)}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<any>;
}

/** The pool a key uses: its account's when it has one, otherwise its own. */
export async function slotOf(env: PhonesEnv, keyId: number) {
  const k = await env.DB.prepare("SELECT account_id FROM api_keys WHERE id = ?").bind(keyId).first<{ account_id: number | null }>();
  return k?.account_id != null ? `acct:${k.account_id}` : `key:${keyId}`;
}

async function charge(env: PhonesEnv, keyId: number) {
  // Quota: each start or resume buys one idle timeout of sandbox time, counted in minutes.
  const q = await env.DB.prepare("SELECT quota_minutes, used_minutes FROM api_keys WHERE id = ?").bind(keyId).first<{ quota_minutes: number; used_minutes: number }>();
  const cost = Math.ceil(timeoutOf(env) / 60);
  if (q && q.quota_minutes > 0 && q.used_minutes + cost > q.quota_minutes) throw new QuotaError(q.quota_minutes, q.used_minutes);
  return async () => { await env.DB.prepare("UPDATE api_keys SET used_minutes = used_minutes + ? WHERE id = ?").bind(cost, keyId).run(); };
}

type Row = { sandbox_id: string; sandbox_host: string; rev: string | null };
/** Finds, resumes or starts the sandbox for a key. `gapMs` is the wait between readiness checks (tests pass 0). */
export async function sandboxForKey(env: PhonesEnv, keyId: number, app: string, scope: string, gapMs = 1000) {
  const slot = await slotOf(env, keyId);
  // A pool from before pools were per account carries over to the account.
  if (slot !== `key:${keyId}`) await env.DB.prepare("UPDATE sim_sessions SET mcp_session = ? WHERE mcp_session = ? AND NOT EXISTS (SELECT 1 FROM sim_sessions WHERE mcp_session = ?)").bind(slot, `key:${keyId}`, slot).run();
  const row = await env.DB.prepare("SELECT sandbox_id, sandbox_host, rev FROM sim_sessions WHERE mcp_session = ?").bind(slot).first<Row>();
  const drop = () => env.DB.prepare("DELETE FROM sim_sessions WHERE mcp_session = ?").bind(slot).run();
  let carry: { phones: unknown[] } | null = null; let old: Row | null = null;
  if (row && env.SIM_REV && row.rev !== env.SIM_REV) {
    // Built by an older deploy: export its phones (waking it if paused), start a new one below, import them there,
    // then delete the old one.
    old = row;
    try {
      if (!(await healthy(row.sandbox_host))) await resumeSandbox(env, row.sandbox_id, row.sandbox_host, gapMs);
      const ex = await phonesCall(env, row.sandbox_id, row.sandbox_host, "/phones/export");
      if (ex?.ok && Array.isArray(ex.phones) && ex.phones.length) carry = ex;
    } catch { /* an old sandbox without export, or gone: the new one starts empty */ }
    await drop();
  } else if (row) {
    if (await healthy(row.sandbox_host)) { touchSandbox(env, row.sandbox_id); return { id: row.sandbox_id, host: row.sandbox_host, resumed: false }; }
    const paid = await charge(env, keyId);
    if (await resumeSandbox(env, row.sandbox_id, row.sandbox_host, gapMs)) { await paid(); return { id: row.sandbox_id, host: row.sandbox_host, resumed: true }; }
    await drop();   // gone for good: start a new one
  }
  const paid = await charge(env, keyId);
  const sb = await newSandbox(env, app, scope, gapMs);
  await paid();
  await phonesCall(env, sb.id, sb.host, "/phones/claim").catch(() => {});
  if (carry) await phonesCall(env, sb.id, sb.host, "/phones/import", carry).catch(() => {});
  if (old) await killSandbox(env, old.sandbox_id);
  await env.DB.prepare("INSERT OR REPLACE INTO sim_sessions (mcp_session, sandbox_id, sandbox_host, app_id, scope, rev) VALUES (?,?,?,?,?,?)").bind(slot, sb.id, sb.host, app, scope, env.SIM_REV ?? null).run();
  return { ...sb, resumed: false };
}

/** The host of a key's existing pool, if there is one (never starts or resumes one). */
export async function existingHost(env: PhonesEnv, keyId: number) {
  // The account's pool, or a pool still filed under the key from before pools were per account.
  const row = await env.DB.prepare("SELECT sandbox_host FROM sim_sessions WHERE mcp_session IN (?, ?) ORDER BY mcp_session = ? ASC LIMIT 1").bind(await slotOf(env, keyId), `key:${keyId}`, `key:${keyId}`).first<{ sandbox_host: string }>();
  return row?.sandbox_host ?? null;
}
