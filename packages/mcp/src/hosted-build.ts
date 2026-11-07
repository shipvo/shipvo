// Builds for the hosted phone: build the app with the simulated device, upload it for this key, check one before opening it.
// Hosted API: POST /builds?app=<id> (body: .tar.gz of the web build) -> { id, expires_at, bytes };
//             GET /builds/<id> -> { id, app, expires_at }, or 404 build_not_found / 410 build_expired.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BuildResult = { ok: true; id: string; expires_at: string; bytes: number } | { ok: false; code: string; error: string };
export type BuildInfo = { ok: true; id: string; app: string; expires_at: string } | { ok: false; code: string; error: string };

export const hostedUrl = () => (process.env.SHIPVO_HOSTED_URL ?? "https://sim.shipvo.dev").replace(/\/$/, "");
/** The key for the hosted phone: SHIPVO_API_KEY, else the one `shipvo login` saved. */
export function hostedKey(): string | null {
  if (process.env.SHIPVO_API_KEY) return process.env.SHIPVO_API_KEY;
  try { return (JSON.parse(readFileSync(join(process.env.SHIPVO_HOME || join(homedir(), ".shipvo"), "credentials.json"), "utf8")) as { key?: string }).key || null; } catch { return null; }
}
const NO_KEY = { ok: false as const, code: "no_api_key", error: "no API key for the hosted phone. Run `shipvo login` or set SHIPVO_API_KEY." };

/** "myapp@build:abc123" -> "abc123"; anything else -> null. */
export const buildIdOf = (app: string) => /@build:([A-Za-z0-9_-]+)$/.exec(app)?.[1] ?? null;

/**
 * Build, pack and upload through `shipvo sim --hosted --json`, so the agent and the terminal share one build and
 * pack path (the build `shipvo sim` makes) and one upload with its error mapping.
 */
export async function uploadBuild(o: { dir: string; app: string }): Promise<BuildResult> {
  const key = hostedKey(); if (!key) return NO_KEY;
  const win = process.platform === "win32";
  const out = await new Promise<string>((resolve) => execFile(win ? "npx.cmd" : "npx", ["-y", "@shipvo/cli", "sim", "--hosted", "--json"], { cwd: o.dir, shell: win, timeout: 600000, maxBuffer: 4 << 20, env: { ...process.env, SHIPVO_API_KEY: key, SHIPVO_HOSTED_URL: hostedUrl() } }, (err, so, se) => resolve(so || (err ? String(se || err.message) : ""))));
  let r: { ok?: boolean; code?: string; summary?: string; data?: { build_id?: string; expires_at?: string; bytes?: number } };
  try { r = JSON.parse(out.trim().split("\n").pop() ?? ""); } catch { return { ok: false, code: "build_failed", error: `shipvo sim --hosted gave no result: ${out.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}` }; }
  if (!r.ok || !r.data?.build_id || !r.data.expires_at) return { ok: false, code: r.code && r.code !== "failed" ? r.code : "upload_failed", error: r.summary ?? "upload failed" };
  return { ok: true, id: r.data.build_id, expires_at: r.data.expires_at, bytes: r.data.bytes ?? 0 };
}

/** Ask the hosted phone whether this key may open the build. */
export async function checkBuild(id: string): Promise<BuildInfo> {
  const key = hostedKey(); if (!key) return NO_KEY;
  try {
    const r = await fetch(`${hostedUrl()}/builds/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
    const d = (await r.json().catch(() => ({}))) as { id?: string; app?: string; expires_at?: string; code?: string; message?: string };
    if (r.ok && d.id) return { ok: true, id: d.id, app: d.app ?? "", expires_at: d.expires_at ?? "" };
    if (r.status === 410) return { ok: false, code: "build_expired", error: `build ${id} has expired and was deleted. Run upload_build again.` };
    if (r.status === 401) return { ok: false, code: "unauthorized", error: "the hosted phone did not accept this key. Run `shipvo login` again." };
    if (r.status >= 500) return { ok: false, code: "unreachable", error: `the hosted phone could not check build ${id} (it answered ${r.status}). Try again in a moment.` };
    return { ok: false, code: "build_not_found", error: `no build ${id} for this key. Builds are private to the account that uploaded them.` };
  } catch (e) { return { ok: false, code: "unreachable", error: `the hosted phone at ${hostedUrl()} did not answer (${(e as Error).message}).` }; }
}
