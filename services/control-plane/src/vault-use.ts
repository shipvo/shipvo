// The secret vault, call-time use: the spec runner asks for a value here, bound to the person,
// the app and the host of the request. The value goes only to the runner's in-memory header or query.
// Nothing here returns it in a response, logs it, or writes it to the use log.
import { decryptSecret } from "./vault-crypto";

type Env = { DB: D1Database; VAULT_MASTER_KEY?: string };
export type VaultRefusal = "missing" | "revoked" | "domain" | "unavailable";
export type VaultResult = { ok: true; value: string } | { ok: false; reason: VaultRefusal };

/** True when `host` is the domain the key was bound to. Exact match only: no subdomains, no suffixes. */
export const sameDomain = (bound: string, host: string) => bound.toLowerCase() === host.toLowerCase().replace(/\.$/, "");

export async function useSecret(env: Env, q: { person: string; app: string; name: string; host: string }): Promise<VaultResult> {
  const record = (outcome: string) =>
    env.DB.prepare("INSERT INTO vault_uses (app_id, name, person, domain, outcome, at) VALUES (?,?,?,?,?,?)")
      .bind(q.app, q.name, q.person, q.host.slice(0, 253), outcome, new Date().toISOString()).run().catch(() => undefined);
  const row: any = await env.DB.prepare("SELECT owner, domain, wrapped_key, ciphertext FROM vault_secrets WHERE app_id = ? AND name = ?").bind(q.app, q.name).first();
  // Another person's key looks the same as a missing one, and is not logged on the owner's list.
  if (!row || row.owner !== q.person) return { ok: false, reason: "missing" };
  const revoked = await env.DB.prepare("SELECT 1 AS r FROM vault_revoked WHERE app_id = ? AND name = ?").bind(q.app, q.name).first();
  if (revoked) { await record("revoked"); return { ok: false, reason: "revoked" }; }
  if (!sameDomain(row.domain, q.host)) { await record("domain_mismatch"); return { ok: false, reason: "domain" }; }
  let value: string;
  try { value = await decryptSecret(env.VAULT_MASTER_KEY, { app: q.app, name: q.name, domain: row.domain }, row); }
  catch { await record("unavailable"); return { ok: false, reason: "unavailable" }; }
  await record("used");
  await env.DB.prepare("UPDATE vault_secrets SET last_used_at = ?, use_count = use_count + 1 WHERE app_id = ? AND name = ?").bind(new Date().toISOString(), q.app, q.name).run();
  return { ok: true, value };
}

/** The `secrets` function for the spec runner, bound to one person and one app. */
export function runnerSecrets(env: Env, who: { person: string; app: string }) {
  return async (name: string, host: string): Promise<string | { refused: VaultRefusal }> => {
    const r = await useSecret(env, { ...who, name, host });
    return r.ok ? r.value : { refused: r.reason };
  };
}

/** The person's own use log: names, hosts, outcomes and times. Never a value. */
export async function listUses(env: Env, q: { person: string; app: string; name: string }) {
  const own: any = await env.DB.prepare("SELECT owner FROM vault_secrets WHERE app_id = ? AND name = ?").bind(q.app, q.name).first();
  if (!own || own.owner !== q.person) return [];
  const r: any = await env.DB.prepare("SELECT domain, outcome, at FROM vault_uses WHERE app_id = ? AND name = ? AND person = ? ORDER BY id DESC LIMIT 100").bind(q.app, q.name, q.person).all();
  return r.results as { domain: string; outcome: string; at: string }[];
}
