// `shipvo sim --hosted`: build the app for the simulator, upload it to the hosted phone for your key, print the build id.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildInto } from "./sim.js";
import { savedCreds } from "./login.js";

export type HostedUpload = { id: string; expires_at: string; bytes: number };
export class HostedError extends Error { constructor(public code: string, message: string) { super(message); } }

/** POST a packed build to the hosted phone. Throws HostedError with a code and a plain message. */
export async function postHostedBuild(o: { url: string; key: string; app: string; body: Buffer }): Promise<HostedUpload> {
  let r: Response;
  try { r = await fetch(`${o.url.replace(/\/$/, "")}/builds?app=${encodeURIComponent(o.app)}`, { method: "POST", headers: { authorization: `Bearer ${o.key}`, "content-type": "application/gzip" }, body: new Uint8Array(o.body) }); }
  catch (e) { throw new HostedError("unreachable", `The hosted phone at ${o.url} did not answer (${(e as Error).message}).`); }
  const d = (await r.json().catch(() => ({}))) as Partial<HostedUpload> & { message?: string; error?: string };
  if (r.status === 401) throw new HostedError("unauthorized", "The hosted phone did not accept your key. Run `shipvo login` again.");
  if (r.status === 413) throw new HostedError("build_too_large", d.message ?? "The build is too large. Remove unused images, fonts and packages, then try again.");
  if (!r.ok || !d.id || !d.expires_at) throw new HostedError("upload_failed", d.message ?? d.error ?? `Upload failed (${r.status}).`);
  return { id: d.id, expires_at: d.expires_at, bytes: d.bytes ?? o.body.length };
}

/** Build, pack and upload the project in the current directory. */
export async function simHosted(appId: string): Promise<HostedUpload> {
  const key = process.env.SHIPVO_API_KEY || savedCreds()?.key;
  if (!key) throw new HostedError("no_api_key", "No API key for the hosted phone. Run `shipvo login` or set SHIPVO_API_KEY.");
  console.error(`Building ${appId} for the simulator…`);
  try { await rebuildInto({ echo: false }); } catch (e) { throw new HostedError("build_failed", `The simulator build failed: ${(e as Error).message.split("\n")[0]}`); }
  const tmp = mkdtempSync(join(tmpdir(), "shipvo-build-"));
  try {
    const tgz = join(tmp, "build.tgz");
    execFileSync("tar", ["-czf", tgz, "-C", "sim-dist", "."]);
    return await postHostedBuild({ url: process.env.SHIPVO_HOSTED_URL || "https://sim.shipvo.dev", key, app: appId, body: readFileSync(tgz) });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
