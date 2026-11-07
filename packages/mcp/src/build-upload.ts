// upload_build: build the project the way `shipvo sim` does, pack it, and send it to the hosted service.
// Hosted contract (the service answers with JSON; errors carry a `code`):
//   POST {hosted}/builds?app=<id>   Authorization: Bearer <key>   body: .tar.gz of the web build   -> 201 { id, app, expires_at }
//   GET  {hosted}/builds/<id>       Authorization: Bearer <key>   -> 200 { id, app, expires_at, url } | 404 build_not_found | 410 build_expired
// A build of another account answers 404 build_not_found, the same as one that never existed.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const hostedUrl = () => (process.env.SHIPVO_HOSTED_URL ?? "https://sim.shipvo.dev").replace(/\/$/, "");
export const hostedKey = () => process.env.SHIPVO_API_KEY ?? "";

export class BuildError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function appIdOf(dir: string): string | undefined {
  try { return JSON.parse(readFileSync(join(dir, "shipvo.json"), "utf8")).appId; } catch { return undefined; }
}

/** Build into `<dir>/sim-dist` the same way `shipvo sim` does. */
export async function buildProject(dir: string): Promise<void> {
  try { await run("npx", ["expo", "export", "--platform", "web", "--output-dir", "sim-dist", "--clear"], { cwd: dir, env: { ...process.env, PN_SIM: "1" }, maxBuffer: 1 << 24, shell: process.platform === "win32" }); }
  catch (e) { throw new BuildError("build_failed", `the build failed: ${String((e as Error).message).split("\n")[0]}`); }
}

export async function packBuild(dir: string): Promise<Buffer> {
  const out = join(mkdtempSync(join(tmpdir(), "shipvo-build-")), "build.tar.gz");
  try {
    await run("tar", ["-czf", out, "-C", join(dir, "sim-dist"), "."]);
    return readFileSync(out);
  } finally { rmSync(join(out, ".."), { recursive: true, force: true }); }
}

export async function uploadBuild(o: { dir?: string; app?: string; skipBuild?: boolean }): Promise<{ id: string; app: string; expires_at: string; bytes: number }> {
  const key = hostedKey();
  if (!key) throw new BuildError("no_api_key", "set SHIPVO_API_KEY to your Shipvo API key so the build can be uploaded for your account");
  const dir = resolve(o.dir ?? process.cwd());
  const app = o.app ?? appIdOf(dir);
  if (!app) throw new BuildError("build_failed", `no app id: pass app, or run in a folder with shipvo.json (looked in ${dir})`);
  if (!o.skipBuild || !existsSync(join(dir, "sim-dist", "index.html"))) await buildProject(dir);
  const body = await packBuild(dir);
  let r: Response;
  try { r = await fetch(`${hostedUrl()}/builds?app=${encodeURIComponent(app)}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/gzip" }, body: new Uint8Array(body) }); }
  catch (e) { throw new BuildError("upload_failed", `could not reach ${hostedUrl()}: ${(e as Error).message}`); }
  const j = (await r.json().catch(() => ({}))) as { id?: string; expires_at?: string; code?: string; error?: string };
  if (r.status === 413 || j.code === "build_too_large") throw new BuildError("build_too_large", `${j.error ?? "the build is too large"}. To make it smaller: remove unused images, fonts and large assets, drop unused dependencies, and upload again.`);
  if (!r.ok || !j.id) throw new BuildError(j.code ?? "upload_failed", j.error ?? `upload failed (${r.status})`);
  return { id: j.id, app, expires_at: j.expires_at ?? "", bytes: body.length };
}

/** Ask the hosted service whether this key may open build `id`. Returns where the simulator loads it from. */
export async function resolveBuild(id: string, key: string): Promise<{ url: string; app: string; expires_at: string }> {
  let r: Response;
  try { r = await fetch(`${hostedUrl()}/builds/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${key}` } }); }
  catch (e) { throw new BuildError("upload_failed", `could not reach ${hostedUrl()}: ${(e as Error).message}`); }
  const j = (await r.json().catch(() => ({}))) as { url?: string; app?: string; expires_at?: string; code?: string; error?: string };
  if (r.status === 410 || j.code === "build_expired") throw new BuildError("build_expired", `build ${id} has expired and was deleted. Run upload_build again.`);
  if (!r.ok || !j.url) throw new BuildError("build_not_found", `no build ${id} for this key. Run upload_build and use the id it returns.`);
  return { url: j.url, app: j.app ?? "", expires_at: j.expires_at ?? "" };
}
