// Opens an uploaded build: fetches it into the build cache and unpacks the tar.gz next to it, once per content id.
// The unpacked folder is what the simulator serves as the app.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fetchBuild, BuildCacheError } from "./build-cache.mjs";

const run = promisify(execFile);

/** The folder a build is unpacked into. */
export const unpackedPath = (dir, id) => join(dir, `${id}.d`);

/**
 * Fetches `buildUrl` and unpacks it. Returns `{ id, root, bytes }`.
 * Throws BuildCacheError (bad_url, host_not_allowed, too_large, unreachable, or bad_build when the file is not a
 * tar.gz with an index.html and no links). A build that fails to unpack leaves no folder behind.
 */
export async function openBuild(buildUrl, opts) {
  const b = await fetchBuild(buildUrl, opts);
  const root = unpackedPath(opts.dir, b.id);
  if (existsSync(join(root, "index.html"))) return { id: b.id, root, bytes: b.bytes };
  const tmp = `${root}.part-${randomUUID()}`;
  try {
    let listing;
    try { listing = (await run("tar", ["-tzvf", b.path], { maxBuffer: 64 * 1024 * 1024 })).stdout; }
    catch { throw new BuildCacheError("bad_build", "the build is not a tar.gz archive"); }
    // Links could point outside the folder, so a build with any is refused.
    if (listing.split("\n").some((l) => /^[lh]/.test(l))) throw new BuildCacheError("bad_build", "the build contains links, which are not allowed");
    await mkdir(tmp, { recursive: true });
    try { await run("tar", ["-xzf", b.path, "-C", tmp, "--no-same-owner", "--no-same-permissions"]); }
    catch { throw new BuildCacheError("bad_build", "the build could not be unpacked"); }
    if (!existsSync(join(tmp, "index.html"))) throw new BuildCacheError("bad_build", "the build has no index.html at its top level");
    await rename(tmp, root).catch(async () => { if (!existsSync(join(root, "index.html"))) throw new BuildCacheError("bad_build", "the build could not be unpacked"); });
    return { id: b.id, root, bytes: b.bytes };
  } catch (e) {
    await rm(b.path, { force: true });
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
