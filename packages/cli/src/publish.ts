// `shipvo publish`: build the Hermes bundle, sign a release pointer, publish bundle + patches + the agent-facing web
// artifact to the control plane. `shipvo rollback --to N`: republish an earlier bundle as a new release.
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex, signBytes } from "./index.js";
import { args as parse, kv as kvFor, loadConfig, seed } from "./config.js";

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ttf": "font/ttf", ".svg": "image/svg+xml" };
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

type Platform = "android" | "ios";
/** Release numbers are shared across platforms, so one number means one commit everywhere. */
async function currentRelease(kv: ReturnType<typeof kvFor>, app: string, major: number) {
  let max = 0;
  for (const b of ["b0", "b1", "b2"]) for (const k of [`p/${app}/${major}/${b}`, `p/${app}/${major}/ios/${b}`]) { const raw = await kv.get(k); if (raw) try { max = Math.max(max, JSON.parse(JSON.parse(raw).body).release); } catch {} }
  return max;
}
const pointerKey = (app: string, major: number, band: string, pf: Platform) => (pf === "ios" ? `p/${app}/${major}/ios/${band}` : `p/${app}/${major}/${band}`);
/** Android keeps its original key names; iOS bundles, patches and history are namespaced so the two never collide. */
const bundleName = (release: number, pf: Platform) => (pf === "ios" ? `ios-r${release}.hbc` : `r${release}.hbc`);
const platformsOf = (a: Record<string, string | undefined>): Platform[] => {
  const p = (a.platform || "android").toLowerCase();
  if (p === "all") return ["android", "ios"];
  if (p === "android" || p === "ios") return [p];
  throw new Error(`--platform must be android, ios or all (got "${a.platform}")`);
};

export async function publish(argv: string[]) {
  const a = parse(argv), cfg = loadConfig(), SEED = seed(), kv = kvFor(cfg);
  const APP = cfg.appId, MAJOR = cfg.shellMajor;
  const MIN_SHELL = a["min-shell"] || JSON.parse(readFileSync("app.json", "utf8")).expo.version; // a bundle needs the shell it was built against
  const bands = (a.bands || "b0,b1,b2").split(",");
  const platforms = platformsOf(a);
  const release = Number(a.release || 0) || (await currentRelease(kv, APP, MAJOR)) + 1;
  const summary: Record<string, unknown> = { app: APP, release, bands, min_shell_version: MIN_SHELL };

  for (const pf of platforms) {
    // Android published alone keeps the original dist-ota/ layout, so existing CI keeps working.
    const root = platforms.length === 1 && pf === "android" ? "dist-ota" : `dist-ota/${pf}`;
    if (a["skip-export"] !== "true") execSync(`npx expo export --platform ${pf} --output-dir ${root} --clear`, { stdio: "inherit" });
    const jsDir = `${root}/_expo/static/js/${pf}`;
    const file = readdirSync(jsDir).find((f) => f.endsWith(".hbc")) || readdirSync(jsDir).find((f) => f.endsWith(".js"));
    if (!file) throw new Error("no bundle in " + jsDir);
    const bytes = new Uint8Array(readFileSync(join(jsDir, file)));
    const name = bundleName(release, pf), newSha = sha256Hex(bytes);
    await kv.put(`b/${APP}/${name}`, bytes, "application/octet-stream");

    // Patches (Android): from recent releases and each shell's embedded bundle; devices verify the patched result against the signed sha256.
    // iOS ships full bundles for now: the iOS runtime does not apply patches yet.
    const patches: { from_sha256: string; url: string; size: number; sha256: string }[] = [];
    if (pf === "android") {
      const MAX_BASES = Number(a["max-bases"] || 6);
      const bases = new Map<string, string>();
      const hist = (await Promise.all((await kv.keys(`h/${APP}/r`)).map(async (k: string) => { try { return JSON.parse((await kv.get(k))!); } catch { return null; } })))
        .filter((h) => h && h.release < release).sort((x, y) => y.release - x.release).slice(0, MAX_BASES - 2);
      for (const h of hist) bases.set(h.sha256, `b/${APP}/r${h.release}.hbc`);
      for (const k of await kv.keys(`base/${APP}/`)) { try { const b = JSON.parse((await kv.get(k))!); bases.set(b.sha256, b.key); } catch {} }
      let bsdiff = true; try { execSync("python3 -c 'import bsdiff4'", { stdio: "ignore" }); } catch { bsdiff = false; console.error("bsdiff4 not installed (pip install bsdiff4): publishing full bundles only"); }
      if (bsdiff) {
        const work = mkdtempSync(join(tmpdir(), "shipvo-")); writeFileSync(join(work, "new.hbc"), bytes);
        for (const [fromSha, key] of bases) {
          if (fromSha === newSha) continue;
          const base = await kv.getBytes(key); if (!base) continue;
          writeFileSync(join(work, "old.hbc"), base);
          execSync(`python3 -c "import bsdiff4; bsdiff4.file_diff('${join(work, "old.hbc")}', '${join(work, "new.hbc")}', '${join(work, "p.bsdiff")}')"`);
          const patch = new Uint8Array(readFileSync(join(work, "p.bsdiff")));
          if (patch.length >= bytes.length * 0.6) continue;
          const pkey = `b/${APP}/d-${fromSha.slice(0, 16)}-r${release}.bsdiff`;
          await kv.put(pkey, patch, "application/octet-stream");
          patches.push({ from_sha256: fromSha, url: pkey, size: patch.length, sha256: sha256Hex(patch) });
        }
      }
      console.error(`patches: ${patches.map((p) => `${p.from_sha256.slice(0, 8)}=${(p.size / 1024).toFixed(1)}KB`).join(", ") || "none"}`);
    }

    // The agent-facing web artifact of the same commit, served at /w/<app>/r<N>/ for the simulator (built once, with the first platform).
    let web: { base: string; entry: string; sha256: string; files: number } | null = null;
    if (a["skip-web"] !== "true" && pf === platforms[0]) {
      web = await publishWeb(kv, cfg, APP, release);
    } else if (a["skip-web"] !== "true") {
      try { web = JSON.parse((await kv.get(`h/${APP}/r${release}`))!)?.web ?? null; } catch {}
    }

    const issued_at = new Date().toISOString();
    for (const band of bands) {
      const body = JSON.stringify({ schema_version: "1.0", app_id: APP, shell_major: MAJOR, band, ...(pf === "ios" ? { platform: "ios" } : {}), release, issued_at,
        core: { version: `1.0.${release}`, sha256: newSha, size: bytes.length, url: `b/${APP}/${name}`, patches },
        addons: [], screens: [], min_shell_version: MIN_SHELL, ...(web ? { web } : {}) });
      await kv.put(pointerKey(APP, MAJOR, band, pf), JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) }), "application/json");
    }
    await kv.put(pf === "ios" ? `h/${APP}/ios-r${release}` : `h/${APP}/r${release}`, JSON.stringify({ release, issued_at, sha256: newSha, size: bytes.length, min_shell_version: MIN_SHELL, web }), "application/json");
    summary[pf] = { bytes: bytes.length, ...(pf === "android" ? { patches: patches.map((p) => ({ from: p.from_sha256.slice(0, 12), kb: +(p.size / 1024).toFixed(1) })) } : {}) };
    if (web) summary.web = web;
  }
  if (platforms.length === 1 && platforms[0] === "android") { // original single-platform output shape
    const an = summary.android as { bytes: number; patches: unknown }; Object.assign(summary, { bytes: an.bytes, patches: an.patches }); delete summary.android;
  }
  console.log(JSON.stringify(summary));
}

async function publishWeb(kv: ReturnType<typeof kvFor>, cfg: ReturnType<typeof loadConfig>, APP: string, release: number) {
  execSync("PN_SIM=1 npx expo export --platform web --output-dir dist-web --clear", { stdio: "inherit" });
  const base = `w/${APP}/r${release}`; const files: string[] = []; let indexSha = "";
  for (const f of walk("dist-web")) {
    const rel = f.slice("dist-web/".length); if (rel === "metadata.json") continue;
    let body = readFileSync(f);
    if (rel === "index.html") { body = Buffer.from(body.toString("utf8").replace(/(src|href)="\//g, `$1="/${base}/`)); indexSha = sha256Hex(new Uint8Array(body)); }
    await kv.put(`${base}/${rel}`, new Uint8Array(body), MIME[rel.slice(rel.lastIndexOf("."))] ?? "application/octet-stream"); files.push(rel);
  }
  const web = { base: `/${base}/`, entry: "index.html", sha256: indexSha, files: files.length };
  const idxKey = `w/${APP}/releases`; let idx: { releases: number[]; latest?: number } = { releases: [] };
  try { idx = JSON.parse((await kv.get(idxKey))!) ?? idx; } catch {}
  idx.releases = [...new Set([...idx.releases, release])].sort((x, y) => x - y); idx.latest = Math.max(...idx.releases);
  await kv.put(idxKey, JSON.stringify(idx), "application/json");
  console.error(`web artifact: ${files.length} files at /${base}/`);
  // Store listing assets (icon, screenshots) and the release note, read by shipvo.dev/apps and list_apps.
  const L = cfg.listing ?? {}; const store = `w/${APP}/store`;
  const up = async (file: string, name: string) => { if (!existsSync(file)) { console.error(`listing: ${file} not found, skipped`); return null; } const ext = file.slice(file.lastIndexOf(".")).toLowerCase(); await kv.put(`${store}/${name}${ext}`, new Uint8Array(readFileSync(file)), MIME[ext] ?? "application/octet-stream"); return `${name}${ext}`; };
  const icon = L.icon ? await up(L.icon, "icon") : null;
  const shots: string[] = []; for (const [i, f] of (L.screenshots ?? []).entries()) { const n = await up(f, `shot-${i + 1}`); if (n) shots.push(n); }
  let note: { headline?: string; note?: string } = {};
  try { const src = readFileSync("src/release.ts", "utf8"); note = { headline: src.match(/headline:\s*"([^"]*)"/)?.[1], note: src.match(/note:\s*"([^"]*)"/)?.[1] }; } catch {}
  await kv.put(`${store}/manifest.json`, JSON.stringify({ icon, screenshots: shots, tagline: L.tagline ?? "", website: L.website ?? "", capabilities: L.capabilities ?? [], release, release_note: note, updated_at: new Date().toISOString() }), "application/json");
  return web;
}

export async function rollback(argv: string[]) {
  const a = parse(argv), cfg = loadConfig(), SEED = seed(), kv = kvFor(cfg);
  const APP = cfg.appId, MAJOR = cfg.shellMajor, to = Number(a.to);
  if (!to) { console.error("Usage: shipvo rollback --to <release> [--bands b0,b1,b2] [--platform android|ios|all]"); process.exit(2); }
  const release = (await currentRelease(kv, APP, MAJOR)) + 1, issued_at = new Date().toISOString();
  let minShell = "1.0.0";
  for (const pf of platformsOf(a)) {
    const bytes = await kv.getBytes(`b/${APP}/${bundleName(to, pf)}`); if (!bytes) { console.error(`Release ${to} ${pf} bundle not found`); process.exit(1); }
    let web: unknown = undefined;
    try { const h = JSON.parse((await kv.get(pf === "ios" ? `h/${APP}/ios-r${to}` : `h/${APP}/r${to}`))!); minShell = h.min_shell_version || minShell; web = h.web ?? undefined; } catch {}
    for (const band of (a.bands || "b0,b1,b2").split(",")) {
      const body = JSON.stringify({ schema_version: "1.0", app_id: APP, shell_major: MAJOR, band, ...(pf === "ios" ? { platform: "ios" } : {}), release, issued_at,
        core: { version: `1.0.${release}`, sha256: sha256Hex(bytes), size: bytes.length, url: `b/${APP}/${bundleName(to, pf)}` }, addons: [], screens: [], min_shell_version: minShell, ...(web ? { web } : {}) });
      await kv.put(pointerKey(APP, MAJOR, band, pf), JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) }), "application/json");
    }
  }
  console.log(JSON.stringify({ app: APP, rolled_back_to_code_of: to, new_release: release, min_shell_version: minShell, issued_at }));
}
