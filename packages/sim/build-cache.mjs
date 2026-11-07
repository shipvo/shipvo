// Memory-bounded cache for uploaded builds: id -> { base }, and their files. Least recently used files are dropped when the
// total size goes over the byte budget; least recently used builds are dropped when there are too many (builds a live
// session still runs are kept). A file bigger than the whole budget is served but not kept.
export const CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const CACHE_MAX_BUILDS = 32;

export function createBuildCache({ maxBytes = CACHE_MAX_BYTES, maxBuilds = CACHE_MAX_BUILDS, inUse = () => false } = {}) {
  const builds = new Map(); // id -> base, oldest first
  const files = new Map(); // `${id}\0${rel}` -> { type, body }, oldest first
  let bytes = 0;
  const drop = (k) => { const f = files.get(k); if (f) { bytes -= f.body.length; files.delete(k); } };
  const dropBuild = (id) => { builds.delete(id); for (const k of [...files.keys()]) if (k.startsWith(`${id}\0`)) drop(k); };
  const evict = () => {
    while (bytes > maxBytes && files.size) drop(files.keys().next().value);
    while (builds.size > maxBuilds) { const old = [...builds.keys()].find((id) => !inUse(id)); if (old === undefined) break; dropBuild(old); }
  };
  return {
    /** Register a build. A new base for a known id forgets its old files. */
    open(id, base) { if (builds.get(id) !== base) dropBuild(id); else builds.delete(id); builds.set(id, base); evict(); },
    base: (id) => builds.get(id),
    get(id, rel) { const k = `${id}\0${rel}`, f = files.get(k); if (f) { files.delete(k); files.set(k, f); } return f; },
    set(id, rel, f) {
      if (!builds.has(id)) return;
      const k = `${id}\0${rel}`; drop(k);
      if (f.body.length <= maxBytes) { files.set(k, f); bytes += f.body.length; }
      evict();
    },
    stats: () => ({ builds: builds.size, files: files.size, bytes }),
  };
}
