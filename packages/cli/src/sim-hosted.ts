// `shipvo sim --hosted`: build the app the way `shipvo sim` does, upload it for this key, print the id to open.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildInto } from "./sim.js";
import { loadConfig } from "./config.js";

export class HostedBuildFailure extends Error { constructor(public code: string, message: string) { super(message); } }

/** Uploads `<root>/sim-dist` (built first unless `skipBuild`). Returns the id the hosted phone opens as `<app>@build:<id>`. */
export async function uploadHosted(opts: { root?: string; skipBuild?: boolean; key?: string; url?: string; app?: string } = {}) {
  const root = opts.root ?? process.cwd();
  const key = opts.key ?? process.env.SHIPVO_API_KEY ?? "";
  if (!key) throw new HostedBuildFailure("no_api_key", "Set SHIPVO_API_KEY to your Shipvo API key (run `shipvo login` to get one).");
  const url = (opts.url ?? process.env.SHIPVO_HOSTED_URL ?? "https://sim.shipvo.dev").replace(/\/$/, "");
  const app = opts.app ?? loadConfig().appId;
  if (!opts.skipBuild || !existsSync(join(root, "sim-dist", "index.html"))) {
    try { await rebuildInto({ root, echo: true }); } catch (e) { throw new HostedBuildFailure("build_failed", `The build failed: ${(e as Error).message.split("\n")[0]}`); }
  }
  const tmp = mkdtempSync(join(tmpdir(), "shipvo-build-"));
  try {
    const file = join(tmp, "build.tar.gz");
    execFileSync("tar", ["-czf", file, "-C", join(root, "sim-dist"), "."]);
    const r = await fetch(`${url}/builds?app=${encodeURIComponent(app)}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/gzip" }, body: new Uint8Array(readFileSync(file)) });
    const j = (await r.json().catch(() => ({}))) as { id?: string; expires_at?: string; code?: string; error?: string };
    if (r.status === 413 || j.code === "build_too_large") throw new HostedBuildFailure("build_too_large", `${j.error ?? "The build is too large"}. To make it smaller: remove unused images, fonts and large assets, drop unused dependencies, then run again.`);
    if (!r.ok || !j.id) throw new HostedBuildFailure(j.code ?? "upload_failed", j.error ?? `The upload failed (${r.status}).`);
    return { id: j.id, app, expires_at: j.expires_at ?? "", open: `${app}@build:${j.id}` };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
