// Fetches a build from a URL into a size-capped cache on disk, stored by content id (sha256).
// The host check is the one the phone browser uses, so a build_url cannot reach the local network by default.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkUrl } from "./phone-browser.mjs";

export const MAX_BUILD_BYTES = 200 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

export class BuildCacheError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** The path a cached build is stored at. */
export function buildPath(dir, id) { return join(dir, id); }

/**
 * Fetches `buildUrl` into `dir` and returns `{ id, bytes, path, cached }`. `id` is the sha256 of the content.
 * Throws BuildCacheError with code bad_url, host_not_allowed, too_large or unreachable, and leaves no file behind.
 * @param opts {dir, maxBytes, timeoutMs, allowPrivate, allowHosts, fetch, resolve}
 */
export async function fetchBuild(buildUrl, opts = {}) {
  const { dir, maxBytes = MAX_BUILD_BYTES, timeoutMs = FETCH_TIMEOUT_MS, allowPrivate = false, allowHosts = [] } = opts;
  const doFetch = opts.fetch ?? fetch;
  const check = async (raw) => {
    let u;
    try { u = await (opts.resolve ? checkUrl(raw, { allowPrivate, allowHosts }, opts.resolve) : checkUrl(raw, { allowPrivate, allowHosts })); }
    catch (e) { throw new BuildCacheError(e.code === "host_not_allowed" ? "host_not_allowed" : "bad_url", e.message); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new BuildCacheError("bad_url", "a build_url must be an http or https URL");
    return u;
  };
  let url = await check(buildUrl);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.part-${randomUUID()}`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let fh;
  try {
    let res;
    for (let hop = 0; ; hop++) {
      try { res = await doFetch(url.href, { redirect: "manual", signal: ctl.signal }); }
      catch (e) { throw new BuildCacheError("unreachable", `could not fetch ${url.host}: ${e.name === "AbortError" ? "timed out" : e.message}`); }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new BuildCacheError("unreachable", "too many redirects");
        url = await check(new URL(res.headers.get("location"), url).href);   // every hop passes the host check
        continue;
      }
      break;
    }
    if (!res.ok || !res.body) throw new BuildCacheError("unreachable", `${url.host} answered ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > maxBytes) throw new BuildCacheError("too_large", `the build is ${declared} bytes; the limit is ${maxBytes}`);
    const hash = createHash("sha256");
    let bytes = 0;
    fh = await open(tmp, "w");
    try {
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new BuildCacheError("too_large", `the build is over the limit of ${maxBytes} bytes`);
        hash.update(chunk);
        await fh.write(chunk);
      }
    } catch (e) {
      if (e instanceof BuildCacheError) throw e;
      throw new BuildCacheError("unreachable", `the download from ${url.host} stopped: ${ctl.signal.aborted ? "timed out" : e.message}`);
    }
    await fh.close(); fh = undefined;
    const id = hash.digest("hex");
    const path = buildPath(dir, id);
    const cached = await stat(path).then(() => true, () => false);
    if (cached) await rm(tmp, { force: true }); else await rename(tmp, path);
    return { id, bytes, path, cached };
  } finally {
    clearTimeout(timer);
    await fh?.close().catch(() => {});
    await rm(tmp, { force: true });
  }
}
