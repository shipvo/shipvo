// Builds for the hosted phone: build the app with the simulated device, upload it for this key, check one before opening it.
// Hosted API: POST /builds?app=<id> (body: .tar.gz of the web build) -> { id, expires_at, bytes };
//             GET /builds/<id> -> { id, app, expires_at }, or 404 build_not_found / 410 build_expired.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = ""; const keep = (d: Buffer) => { tail = (tail + d).slice(-2000); };
    p.stdout.on("data", keep); p.stderr.on("data", keep);
    p.on("error", (e) => resolve({ code: 1, tail: e.message }));
    p.on("close", (code) => resolve({ code: code ?? 1, tail }));
  });
}

/** Build with the simulated device (the build `shipvo sim` makes), pack it, upload it. */
export async function uploadBuild(o: { dir: string; app: string }): Promise<BuildResult> {
  const key = hostedKey(); if (!key) return NO_KEY;
  const tmp = mkdtempSync(join(tmpdir(), "shipvo-build-"));
  try {
    const out = join(tmp, "web");
    const b = await run("npx", ["expo", "export", "--platform", "web", "--output-dir", out, "--clear"], o.dir, { ...process.env, PN_SIM: "1" });
    if (b.code !== 0 || !existsSync(join(out, "index.html"))) return { ok: false, code: "build_failed", error: `the simulator build failed: ${b.tail.trim().split("\n").slice(-3).join(" | ")}` };
    const tgz = join(tmp, "build.tgz");
    const t = await run("tar", ["-czf", tgz, "-C", out, "."], tmp);
    if (t.code !== 0) return { ok: false, code: "build_failed", error: `could not pack the build: ${t.tail.trim()}` };
    return await postBuild(o.app, readFileSync(tgz), key);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Upload a packed build. Split out so the CLI path and tests share the error handling. */
export async function postBuild(app: string, body: Buffer, key = hostedKey()): Promise<BuildResult> {
  if (!key) return NO_KEY;
  let r: Response;
  try { r = await fetch(`${hostedUrl()}/builds?app=${encodeURIComponent(app)}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/gzip" }, body: new Uint8Array(body), signal: AbortSignal.timeout(120000) }); }
  catch (e) { return { ok: false, code: "unreachable", error: `the hosted phone at ${hostedUrl()} did not answer (${(e as Error).message}).` }; }
  const d = (await r.json().catch(() => ({}))) as { id?: string; expires_at?: string; bytes?: number; code?: string; error?: string; message?: string };
  if (r.status === 401) return { ok: false, code: "unauthorized", error: "the hosted phone did not accept this key. Run `shipvo login` again." };
  if (r.status === 413) return { ok: false, code: "build_too_large", error: d.message ?? "the build is too large. Remove unused images, fonts and packages, then upload again." };
  if (!r.ok || !d.id || !d.expires_at) return { ok: false, code: "upload_failed", error: d.message ?? d.error ?? `upload failed (${r.status})` };
  return { ok: true, id: d.id, expires_at: d.expires_at, bytes: d.bytes ?? body.length };
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
    return { ok: false, code: "build_not_found", error: `no build ${id} for this key. Builds are private to the account that uploaded them.` };
  } catch (e) { return { ok: false, code: "unreachable", error: `the hosted phone at ${hostedUrl()} did not answer (${(e as Error).message}).` }; }
}
