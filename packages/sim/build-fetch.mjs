// Uploaded builds: open_app("<app>@build:<id>") sends build_url, the base address of the uploaded web build
// (https://<host>/files/<id>/). The simulator fetches index.html when the session starts, then serves the rest of the
// files on demand through /b/<id>/. Only allow-listed hosts are fetched, every file has a size cap and a timeout.
export class BuildFetchError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const BUILD_MAX_BYTES = 50 * 1024 * 1024;
export const BUILD_TIMEOUT_MS = 15_000;

/** Parse a build_url. Returns { id, base } or throws bad_build_url / build_url_not_allowed. `hosts` is the allow-list of host names. */
export function parseBuildUrl(raw, hosts) {
  let u; try { u = new URL(String(raw)); } catch { throw new BuildFetchError("bad_build_url", "build_url is not a URL"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BuildFetchError("bad_build_url", "build_url must be an http or https address");
  if (u.username || u.password) throw new BuildFetchError("bad_build_url", "build_url must not carry a user name or password");
  const m = /^\/files\/([\w-]{1,64})\/?$/.exec(u.pathname);
  if (!m) throw new BuildFetchError("bad_build_url", "build_url must look like https://<host>/files/<id>/");
  if (!hosts.map((h) => h.toLowerCase()).includes(u.hostname.toLowerCase())) throw new BuildFetchError("build_url_not_allowed", `${u.hostname} is not a host builds are loaded from`);
  return { id: m[1], base: `${u.origin}/files/${m[1]}/` };
}

/** Fetch one file of a build with a size cap and a timeout. Returns { type, body }. Throws build_unreachable / build_too_large. */
export async function fetchBuildFile(base, path, { maxBytes = BUILD_MAX_BYTES, timeoutMs = BUILD_TIMEOUT_MS, fetchFn = fetch } = {}) {
  const url = new URL(path.replace(/^\/+/, ""), base);
  if (!url.href.startsWith(base)) throw new BuildFetchError("bad_build_url", "path leaves the build");
  let r;
  try { r = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new BuildFetchError("build_unreachable", `could not load the build: ${e?.name === "TimeoutError" ? `no answer within ${timeoutMs / 1000} s` : e?.cause?.code ?? e?.message ?? e}`); }
  if (!r.ok) throw new BuildFetchError("build_unreachable", `could not load the build: the server answered ${r.status}`);
  const tooBig = () => new BuildFetchError("build_too_large", `the build is over the ${Math.round(maxBytes / 1048576)} MB size limit`);
  if (Number(r.headers.get("content-length") ?? 0) > maxBytes) throw tooBig();
  const chunks = []; let n = 0;
  try { for await (const c of r.body ?? []) { n += c.length; if (n > maxBytes) { throw tooBig(); } chunks.push(c); } }
  catch (e) { if (e instanceof BuildFetchError) throw e; throw new BuildFetchError("build_unreachable", `could not load the build: ${e?.message ?? e}`); }
  return { type: r.headers.get("content-type") ?? "application/octet-stream", body: Buffer.concat(chunks) };
}
