// `shipvo publish`: build the Hermes bundle, sign a release pointer, publish bundle + patches + the agent-facing web
// artifact to the control plane. `shipvo rollback --to N`: republish an earlier bundle as a new release.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path, { dirname, join, relative, resolve } from "node:path";
import { sha256Hex, signBytes } from "./index.js";
import { bsdiff } from "./bsdiff.js";
import { checkBundle, checkEngine, installedHermesEngine, parseDeclared, parseEngine } from "./hermes.js";
import { requiredNativeModules } from "./native.js";
import { checkPublishPolicy } from "./policy.js";
import { CliFailure, UsageError, runJson, type Done, type Next } from "./json-out.js";
import { args as parse, hasStore, kv as kvFor, loadConfig, offlineKv, seed } from "./config.js";

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
  throw new UsageError(`--platform must be android, ios or all (got "${a.platform}")`);
};

/** Unknown flags are errors: a typo like --dryrun must not fall through to a real publish. */
function checkFlags(argv: string[], known: string[]) {
  const bad = argv.filter((x) => x.startsWith("--") && !known.includes(x.slice(2)));
  if (bad.length) {
    const eq = bad.find((x) => x.includes("="));
    const hint = eq ? ` Write "${eq.replace("=", " ")}" (a space, not =).` : "";
    throw new UsageError(`Unknown flag ${bad.join(", ")}.${hint} Known flags: ${known.map((k) => "--" + k).join(" ")}`);
  }
}

/** An on/off flag: bare or "true" is on, "false" is off. Anything else is an error, so a typo never flips it silently. */
function switchFlag(a: Record<string, string | undefined>, name: string): boolean {
  const v = a[name];
  if (v === undefined || v === "false") return false;
  if (v === "true") return true;
  throw new UsageError(`--${name} is an on/off flag: use --${name}, --${name} true or --${name} false (got "${v}")`);
}

/** True when `file` is strictly inside `root`. Uses the platform's separator, so it works with Windows paths too. */
export function isInside(root: string, file: string, p: typeof path.posix = path): boolean {
  const rel = p.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !p.isAbsolute(rel);
}

/** A store that only writes files under `dir` (key `p/app/1/b0` becomes `dir/p/app/1/b0`). It reads back only what this run wrote (kept in memory), never old files, so the iOS pass can find the web artifact and a dry run never needs a control plane. */
function localKv(dir: string) {
  const root = resolve(dir);
  const mem = new Map<string, Uint8Array<ArrayBuffer>>();
  const enc = new TextEncoder();
  return {
    async get(k: string): Promise<string | null> { const v = mem.get(k); return v ? new TextDecoder().decode(v) : null; },
    async getBytes(k: string): Promise<Uint8Array<ArrayBuffer> | null> { return mem.get(k) ?? null; },
    async keys(prefix: string): Promise<string[]> { return [...mem.keys()].filter((k) => k.startsWith(prefix)); },
    async put(k: string, body: BodyInit, _type: string) {
      const f = resolve(root, k);
      if (!isInside(root, f)) throw new Error(`refusing to write outside ${dir}: ${k}`);
      const bytes = typeof body === "string" ? enc.encode(body) : new Uint8Array(body as Uint8Array);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, bytes);
      mem.set(k, bytes);
    },
  };
}

const PUBLISH_FLAGS = ["bands", "platform", "release", "min-shell", "hermes-bytecode-version", "max-bases", "skip-export", "skip-web", "dry-run", "dry-run-policy", "out", "json"];

export const PUBLISH_HELP = `Usage: shipvo publish [flags]

Build, sign and publish an over-the-air release.

Flags (write a value after a space, not =; on/off flags can be bare, or true/false):
  --bands b0,b1,b2             Cohorts to publish to (default b0,b1,b2)
  --platform android|ios|all   Platform to publish (default android)
  --release N                  Release number (default: the next one)
  --min-shell X.Y.Z            Oldest app shell that can run this release (default: version in app.json)
  --hermes-bytecode-version V  Refuse bundles built for another Hermes version, for example 96 or 96,98
  --max-bases N                How many older releases to build patches from (default 6)
  --skip-export               Reuse the last build in dist-ota/
  --skip-web                  Do not publish the web copy for the simulator
  --dry-run                    Build and sign, write files locally, send nothing
  --dry-run-policy             Check the policy in shipvo.json for these --bands, print the result, publish nothing
  --out <dir>                  Where --dry-run writes files (default .shipvo/dry-run)
  --json                       Print one JSON envelope on stdout; text and build output go to stderr
  --help                       Show this help
`;

const DOCTOR: Next[] = [{ command: "shipvo doctor --json", why: "Check your setup." }];

export async function publish(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(PUBLISH_HELP); return; }
  if (argv.includes("--json")) return runJson(() => publishRun(argv, true), DOCTOR);
  await publishRun(argv, false);
}

async function publishRun(argv: string[], json: boolean): Promise<Done> {
  // In --json mode the build tools must not write to stdout either.
  const io: "inherit" | ["inherit", 2, 2] = json ? ["inherit", 2, 2] : "inherit";
  checkFlags(argv, PUBLISH_FLAGS);
  const a = parse(argv), cfg = loadConfig(), SEED = seed();
  if (switchFlag(a, "dry-run-policy")) {
    const verdict = checkPublishPolicy(cfg.policy, (a.bands || "b0,b1,b2").split(","));
    if (verdict.ok) {
      const msg = cfg.policy === undefined ? "No policy in shipvo.json: nothing to check." : "Policy allows this publish.";
      console.log(msg);
      return { code: "policy_ok", summary: msg, data: { policy: cfg.policy === undefined ? "none" : "allowed", bands: (a.bands || "b0,b1,b2").split(",") }, next: [{ command: "shipvo publish --dry-run --json", why: "Build and sign without sending." }] };
    }
    return refused(verdict, json);
  }
  const dry = switchFlag(a, "dry-run"), skipExport = switchFlag(a, "skip-export"), skipWeb = switchFlag(a, "skip-web");
  if (a.out !== undefined && !dry) throw new UsageError("--out only works with --dry-run");
  if (a.out === "true") throw new UsageError("--out needs a directory: pass --out <dir>");
  const outDir = a.out || ".shipvo/dry-run";
  const kv = dry ? localKv(outDir) : kvFor(cfg);
  const APP = cfg.appId, MAJOR = cfg.shellMajor;
  const MIN_SHELL = a["min-shell"] || JSON.parse(readFileSync("app.json", "utf8")).expo.version; // a bundle needs the shell it was built against
  if (a["hermes-bytecode-version"] === "true") throw new UsageError("--hermes-bytecode-version needs a value: pass a value like 96 (or 96,98)");
  const declaredHermes = parseDeclared(a["hermes-bytecode-version"] ?? cfg.hermesBytecodeVersion);
  const hermesEngine = checkEngine(installedHermesEngine(process.cwd()), parseEngine(cfg.hermesEngine)); // fails before anything is uploaded
  const skippedNative: string[] = [];
  const nativeModules = requiredNativeModules(".", skippedNative);
  if (skippedNative.length) console.error(`native modules not recorded (the range is not a plain numeric semver range, so the control plane cannot check it): ${skippedNative.join(", ")}`);
  if (dry) console.error(`native modules this release requires: ${nativeModules ? Object.entries(nativeModules).map(([n, r]) => `${n}@${r}`).join(", ") : "none found"}`);
  const bands = (a.bands || "b0,b1,b2").split(",");
  if (dry) {
    const verdict = checkPublishPolicy(cfg.policy, bands);
    if (!verdict.ok) return refused(verdict, json);
  }
  const platforms = platformsOf(a);
  const release = Number(a.release || 0) || (await currentRelease(kv, APP, MAJOR)) + 1;
  const summary: Record<string, unknown> = { app: APP, release, bands, min_shell_version: MIN_SHELL, ...(nativeModules ? { required_native_modules: nativeModules } : {}), ...(dry ? { dry_run: true, out: outDir } : {}) };
  if (dry) console.error(`dry run: nothing is sent anywhere; files go to ${outDir}. No patches are built offline. Release is ${release}${a.release ? "" : " (pass --release N to match the control plane)"}.`);

  let totalBytes = 0;
  const patchInfo = { bases: 0, bsdiff: false, patches: 0 };
  for (const pf of platforms) {
    // Android published alone keeps the original dist-ota/ layout, so existing CI keeps working.
    const root = platforms.length === 1 && pf === "android" ? "dist-ota" : `dist-ota/${pf}`;
    if (!skipExport) execSync(`npx expo export --platform ${pf} --output-dir ${root} --clear`, { stdio: io });
    const jsDir = `${root}/_expo/static/js/${pf}`;
    const file = readdirSync(jsDir).find((f) => f.endsWith(".hbc")) || readdirSync(jsDir).find((f) => f.endsWith(".js"));
    if (!file) throw new CliFailure("no bundle in " + jsDir, "no_bundle", 1, [{ command: "shipvo publish --json", why: "Run again without --skip-export so the bundle is built." }]);
    const bytes = new Uint8Array(readFileSync(join(jsDir, file)));
    const hermesVersion = checkBundle(file, bytes, declaredHermes); // fails before anything is uploaded
    const name = bundleName(release, pf), newSha = sha256Hex(bytes);
    await kv.put(`b/${APP}/${name}`, bytes, "application/octet-stream");

    // Patches: from recent releases and each shell's embedded bundle; devices verify the patched result against the signed sha256.
    // Releases are per platform. Embedded-bundle records are shared under base/<app>/ and tagged with a platform (no tag means Android).
    const patches: { from_sha256: string; url: string; size: number; sha256: string }[] = [];
    {
      const MAX_BASES = Number(a["max-bases"] || 6);
      const bases = new Map<string, string>();
      const hist = (await Promise.all((await kv.keys(pf === "ios" ? `h/${APP}/ios-r` : `h/${APP}/r`)).map(async (k: string) => { try { return JSON.parse((await kv.get(k))!); } catch { return null; } })))
        .filter((h) => h && h.release < release).sort((x, y) => y.release - x.release).slice(0, MAX_BASES - 2);
      for (const h of hist) bases.set(h.sha256, `b/${APP}/${bundleName(h.release, pf)}`);
      for (const k of await kv.keys(`base/${APP}/`)) { try { const b = JSON.parse((await kv.get(k))!); if ((b.platform ?? "android") === pf) bases.set(b.sha256, b.key); } catch {} }
      // Patches are built in-process (no Python or other tool); a first release has no older bundle to patch from.
      const hasBases = bases.size > 0;
      if (hasBases) {
        for (const [fromSha, key] of bases) {
          if (fromSha === newSha) continue;
          const base = await kv.getBytes(key); if (!base) continue;
          const patch = bsdiff(new Uint8Array(base), bytes);
          if (patch.length >= bytes.length * 0.6) continue;
          const pkey = `b/${APP}/${pf === "ios" ? "ios-" : ""}d-${fromSha.slice(0, 16)}-r${release}.bsdiff`;
          await kv.put(pkey, patch, "application/octet-stream");
          patches.push({ from_sha256: fromSha, url: pkey, size: patch.length, sha256: sha256Hex(patch) });
        }
      }
      patchInfo.bases = bases.size; patchInfo.bsdiff = hasBases; patchInfo.patches = patches.length;
      console.error(`patches: ${patches.map((p) => `${p.from_sha256.slice(0, 8)}=${(p.size / 1024).toFixed(1)}KB`).join(", ") || "none"}`);
    }

    // The agent-facing web artifact of the same commit, served at /w/<app>/r<N>/ for the simulator (built once, with the first platform).
    let web: { base: string; entry: string; sha256: string; files: number } | null = null;
    if (!skipWeb && pf === platforms[0]) {
      web = await publishWeb(kv, cfg, APP, release, dry ? outDir : undefined, io);
    } else if (!skipWeb) {
      try { web = JSON.parse((await kv.get(`h/${APP}/r${release}`))!)?.web ?? null; } catch {}
    }

    const issued_at = new Date().toISOString();
    for (const band of bands) {
      const body = JSON.stringify({ schema_version: "1.0", app_id: APP, shell_major: MAJOR, band, ...(pf === "ios" ? { platform: "ios" } : {}), release, issued_at,
        core: { version: `1.0.${release}`, sha256: newSha, size: bytes.length, url: `b/${APP}/${name}`, patches },
        addons: [], screens: [], min_shell_version: MIN_SHELL, ...(hermesVersion ? { hermes_bytecode_version: hermesVersion } : {}), ...(hermesVersion && hermesEngine ? { hermes_engine: hermesEngine } : {}), ...(nativeModules ? { required_native_modules: nativeModules } : {}), ...(web ? { web } : {}) });
      await kv.put(pointerKey(APP, MAJOR, band, pf), JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) }), "application/json");
    }
    await kv.put(pf === "ios" ? `h/${APP}/ios-r${release}` : `h/${APP}/r${release}`, JSON.stringify({ release, issued_at, sha256: newSha, size: bytes.length, min_shell_version: MIN_SHELL, ...(hermesVersion ? { hermes_bytecode_version: hermesVersion } : {}), ...(hermesVersion && hermesEngine ? { hermes_engine: hermesEngine } : {}), ...(nativeModules ? { required_native_modules: nativeModules } : {}), web }), "application/json");
    totalBytes += bytes.length;
    summary[pf] = { bytes: bytes.length, patches: patches.map((p) => ({ from: p.from_sha256.slice(0, 12), kb: +(p.size / 1024).toFixed(1) })) };
    if (web) summary.web = web;
  }
  if (platforms.length === 1 && platforms[0] === "android") { // original single-platform output shape
    const an = summary.android as { bytes: number; patches: unknown }; Object.assign(summary, { bytes: an.bytes, patches: an.patches }); delete summary.android;
  }
  if (dry) console.log(dryRunSummary(release, totalBytes, outDir, patchInfo));
  else console.log(JSON.stringify(summary));
  const flags = [a.bands ? `--bands ${a.bands}` : "", a.platform ? `--platform ${a.platform}` : ""].filter(Boolean).join(" ");
  const data = { ...summary, platforms, total_bytes: totalBytes };
  if (dry) return { code: "dry_run", summary: `Dry run complete: release ${release}, ${formatSize(totalBytes)}. Nothing was sent.`, data, next: [{ command: `shipvo publish ${flags} --json`.replace(/ +/g, " "), why: "Publish for real." }] };
  const rest = ["b0", "b1", "b2"].filter((b) => !bands.includes(b));
  const next: Next[] = [{ command: "shipvo status --json", why: "See how the release does on phones." }];
  if (rest.length) next.push({ command: `shipvo promote --to ${rest.join(",")} --json`, why: `Widen release ${release} to ${rest.join(", ")} when it looks healthy.` });
  return { code: "published", summary: `Published release ${release} to ${bands.join(", ")} (${platforms.join(", ")}).`, data, next };
}

function refused(verdict: { rule?: unknown; reason?: unknown }, json: boolean): Done {
  const msg = `Refused by policy rule ${verdict.rule}: ${verdict.reason}`;
  if (json) throw new CliFailure(msg, "policy_refused", 1, [{ command: "shipvo publish --dry-run-policy --json", why: "Check the policy for other --bands." }]);
  console.error(msg); process.exitCode = 1;
  return { code: "policy_refused", summary: msg, data: {}, next: [] };
}

/** Bytes in plain units: KB below 1 MB, so a small bundle never reads as 0.00 MB. */
export function formatSize(bytes: number) {
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
}

/** The dry-run result in plain words. `info` says what happened with patches on Android. */
export function dryRunSummary(release: number, bytes: number, outDir: string, info: { bases: number; bsdiff: boolean; patches: number } = { bases: 0, bsdiff: false, patches: 0 }) {
  const lines = [
    `Dry run complete. Nothing was sent.`,
    `  Release:  ${release}`,
    `  Size:     ${formatSize(bytes)}`,
    `  Files:    ${outDir}`,
  ];
  if (info.bases === 0 && release > 1) lines.push(`Patches are not built in a dry run, because older releases are not read. Publish for real to build them.`);
  else if (info.bases === 0) lines.push(`Full bundles are fine for a first release. Small patches matter once you have older releases to compare against.`);
  else if (!info.bsdiff) lines.push(`Patches were skipped. Full bundles still work.`);
  else lines.push(`Patches built: ${info.patches}.`);
  return lines.join("\n");
}

async function publishWeb(kv: ReturnType<typeof kvFor>, cfg: ReturnType<typeof loadConfig>, APP: string, release: number, outDir?: string, io: "inherit" | ["inherit", 2, 2] = "inherit") {
  execSync("npx expo export --platform web --output-dir dist-web --clear", { stdio: io, env: { ...process.env, PN_SIM: "1" } });
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
  // Show where the files are on disk, relative to this folder: the URL path (/w/...) is not a folder.
  const where = outDir ? (relative(process.cwd(), resolve(outDir, base)) || ".") + "/" : `/${base}/`;
  console.error(`web artifact: ${files.length} files at ${where}`);
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
  if (argv.includes("--json")) return runJson(() => rollbackRun(argv, true), [...DOCTOR, { command: "shipvo status --json", why: "See the newest releases." }]);
  await rollbackRun(argv, false);
}

async function rollbackRun(argv: string[], json: boolean): Promise<Done> {
  checkFlags(argv, ["to", "bands", "platform", "dry-run", "json"]);
  const a = parse(argv), dry = a["dry-run"] !== undefined, cfg = loadConfig();
  const offline = dry && !hasStore();
  const SEED = dry ? "" : seed(), kv = offline ? offlineKv() : kvFor(cfg);
  if (offline) console.error("Offline rehearsal: reading releases from .shipvo/dry-run (written by shipvo publish --dry-run). No login used, nothing is sent.");
  const APP = cfg.appId, MAJOR = cfg.shellMajor, to = Number(a.to);
  if (!to) {
    const usage = "Usage: shipvo rollback --to <release> [--bands b0,b1,b2] [--platform android|ios|all] [--dry-run] [--json]";
    if (json) throw new UsageError(usage);
    console.error(usage); process.exit(2);
  }
  const release = (await currentRelease(kv, APP, MAJOR)) + 1, issued_at = new Date().toISOString();
  let minShell = "1.0.0";
  const platforms = platformsOf(a), bands = (a.bands || "b0,b1,b2").split(",");
  for (const pf of platforms) {
    const bytes = await kv.getBytes(`b/${APP}/${bundleName(to, pf)}`);
    if (!bytes) {
      if (json) throw new CliFailure(`Release ${to} ${pf} bundle not found`, "not_found", 1, [{ command: "shipvo status --json", why: "See which releases exist." }]);
      console.error(`Release ${to} ${pf} bundle not found`); process.exit(1);
    }
    let web: unknown = undefined;
    try { const h = JSON.parse((await kv.get(pf === "ios" ? `h/${APP}/ios-r${to}` : `h/${APP}/r${to}`))!); minShell = h.min_shell_version || minShell; web = h.web ?? undefined; } catch {}
    for (const band of bands) {
      const body = JSON.stringify({ schema_version: "1.0", app_id: APP, shell_major: MAJOR, band, ...(pf === "ios" ? { platform: "ios" } : {}), release, issued_at,
        core: { version: `1.0.${release}`, sha256: sha256Hex(bytes), size: bytes.length, url: `b/${APP}/${bundleName(to, pf)}` }, addons: [], screens: [], min_shell_version: minShell, ...(web ? { web } : {}) });
      if (!dry) await kv.put(pointerKey(APP, MAJOR, band, pf), JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) }), "application/json");
    }
  }
  const data = { app: APP, rolled_back_to_code_of: to, new_release: release, min_shell_version: minShell, issued_at, platforms, bands, dry_run: dry };
  if (dry) {
    console.log([`Rollback preview for ${APP}:`, `  Rolling back to the code of release ${to}`, `  New release number: ${release}`, `  Platforms: ${platforms.join(", ")}`, `  Bands: ${bands.join(", ")}`, `  Min shell version: ${minShell}`, `Dry run: nothing was written.`].join("\n"));
    const real = argv.filter((x) => x !== "--dry-run").join(" ");
    return { code: "dry_run", summary: `Rollback preview: release ${to} code becomes release ${release}. Nothing was written.`, data, next: [{ command: `shipvo rollback ${real}`, why: "Do the rollback." }] };
  }
  console.log(JSON.stringify({ app: APP, rolled_back_to_code_of: to, new_release: release, min_shell_version: minShell, issued_at }));
  return { code: "rolled_back", summary: `Rolled back to the code of release ${to} as release ${release}.`, data, next: [{ command: "shipvo status --json", why: "Check that phones pick up the rollback." }] };
}
