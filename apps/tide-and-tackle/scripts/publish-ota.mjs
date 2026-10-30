#!/usr/bin/env node
// Build the JS bundle (Hermes bytecode), sign a release pointer and publish both to the control plane's KV.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PURENATIVE_SIGNING_SEED (or PURENATIVE_SIGNING_SEED_FILE),
//      PURENATIVE_KV_ID (defaults to the control plane's POINTERS namespace).
// Usage: node scripts/publish-ota.mjs [--bands b0,b1,b2] [--release N] [--min-shell 1.0.0] [--skip-export]
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signBytes, sha256Hex } from "@shipvo/cli";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : a), []));
const APP_ID = "tide", SHELL_MAJOR = 1;
// A bundle needs the native code of the shell it was built against: default to the app's current version.
const MIN_SHELL = JSON.parse(readFileSync("app.json", "utf8")).expo.version;
const ACC = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV = process.env.PURENATIVE_KV_ID || "c0851feca4c5486d8ed844d16f0b36df";
const SEED = process.env.PURENATIVE_SIGNING_SEED || (process.env.PURENATIVE_SIGNING_SEED_FILE && readFileSync(process.env.PURENATIVE_SIGNING_SEED_FILE, "utf8").trim());
if (!ACC || !TOKEN || !SEED) { console.error("Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN or signing seed"); process.exit(1); }
const bands = (args.bands || "b0,b1,b2").split(",");
const kvUrl = (k) => `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(k)}`;
const auth = { Authorization: `Bearer ${TOKEN}` };

async function kvGet(k) { const r = await fetch(kvUrl(k), { headers: auth }); return r.ok ? r.text() : null; }
async function kvGetBytes(k) { const r = await fetch(kvUrl(k), { headers: auth }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; }
async function kvKeys(prefix) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`, { headers: auth });
  return r.ok ? (await r.json()).result.map((k) => k.name) : [];
}
async function kvPut(k, body, type) {
  const r = await fetch(kvUrl(k), { method: "PUT", headers: { ...auth, "content-type": type }, body });
  if (!r.ok) throw new Error(`KV put ${k}: ${r.status} ${await r.text()}`);
}

let release = Number(args.release || 0);
if (!release) {
  let max = 0;
  for (const b of ["b0", "b1", "b2"]) {
    const raw = await kvGet(`p/${APP_ID}/${SHELL_MAJOR}/${b}`);
    if (raw) try { max = Math.max(max, JSON.parse(JSON.parse(raw).body).release); } catch {}
  }
  release = max + 1;
}

if (args["skip-export"] !== "true") execSync("npx expo export --platform android --output-dir dist-ota --clear", { stdio: "inherit" });
const jsDir = "dist-ota/_expo/static/js/android";
const file = readdirSync(jsDir).find((f) => f.endsWith(".hbc")) || readdirSync(jsDir).find((f) => f.endsWith(".js"));
if (!file) throw new Error("no bundle in " + jsDir);
const bytes = new Uint8Array(readFileSync(join(jsDir, file)));
const name = `r${release}.hbc`;
await kvPut(`b/${APP_ID}/${name}`, bytes, "application/octet-stream");

// Patches: from the last few releases' bundles and from each shell's embedded (APK) bundle, so even the
// first update after install is a patch. Devices verify the patched result against the signed sha256.
const MAX_BASES = Number(args["max-bases"] || 6);
const bases = new Map(); // sha256 -> kv key of base bytes
const hist = (await Promise.all((await kvKeys(`h/${APP_ID}/r`)).map(async (k) => { try { return JSON.parse(await kvGet(k)); } catch { return null; } })))
  .filter((h) => h && h.release < release).sort((a, b) => b.release - a.release).slice(0, MAX_BASES - 2);
for (const h of hist) bases.set(h.sha256, `b/${APP_ID}/r${h.release}.hbc`);
for (const k of await kvKeys(`base/${APP_ID}/`)) { try { const b = JSON.parse(await kvGet(k)); bases.set(b.sha256, b.key); } catch {} }
const newSha = sha256Hex(bytes);
const patches = [];
const work = mkdtempSync(join(tmpdir(), "pn-"));
writeFileSync(join(work, "new.hbc"), bytes);
for (const [fromSha, key] of bases) {
  if (fromSha === newSha) continue;
  const base = await kvGetBytes(key); if (!base) continue;
  writeFileSync(join(work, "old.hbc"), base);
  execSync(`python3 -c "import bsdiff4; bsdiff4.file_diff('${join(work, "old.hbc")}', '${join(work, "new.hbc")}', '${join(work, "p.bsdiff")}')"`);
  const patch = new Uint8Array(readFileSync(join(work, "p.bsdiff")));
  if (patch.length >= bytes.length * 0.6) continue; // not worth it
  const pkey = `b/${APP_ID}/d-${fromSha.slice(0, 16)}-r${release}.bsdiff`;
  await kvPut(pkey, patch, "application/octet-stream");
  patches.push({ from_sha256: fromSha, url: pkey, size: patch.length, sha256: sha256Hex(patch) });
}
console.error(`patches: ${patches.map((p) => `${p.from_sha256.slice(0, 8)}=${(p.size / 1024).toFixed(1)}KB`).join(", ") || "none"}`);

// The agent-facing web artifact of the same release: the simulator (and sim.shipvo.dev) opens app@rN from here.
// Same commit, same content, platform adapters only; served at /w/<app>/r<N>/.
let web = null;
if (args["skip-web"] !== "true") {
  execSync("PN_SIM=1 npx expo export --platform web --output-dir dist-web --clear", { stdio: "inherit" });
  const base = `w/${APP_ID}/r${release}`;
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const files = []; let indexSha = "";
  for (const f of walk("dist-web")) {
    const rel = f.slice("dist-web/".length); if (rel === "metadata.json") continue;
    let body = readFileSync(f);
    if (rel === "index.html") { body = Buffer.from(body.toString("utf8").replace(/(src|href)="\//g, `$1="/${base}/`)); indexSha = sha256Hex(new Uint8Array(body)); }
    const type = rel.endsWith(".html") ? "text/html" : rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".json") ? "application/json" : rel.endsWith(".css") ? "text/css" : rel.endsWith(".ico") ? "image/x-icon" : rel.endsWith(".png") ? "image/png" : rel.endsWith(".ttf") ? "font/ttf" : "application/octet-stream";
    await kvPut(`${base}/${rel}`, new Uint8Array(body), type); files.push(rel);
  }
  web = { base: `/${base}/`, entry: "index.html", sha256: indexSha, files: files.length };
  const idxKey = `w/${APP_ID}/releases`; let idx = { releases: [] }; try { idx = JSON.parse(await kvGet(idxKey)) ?? idx; } catch {}
  idx.releases = [...new Set([...idx.releases, release])].sort((a, b) => a - b); idx.latest = Math.max(...idx.releases);
  await kvPut(idxKey, JSON.stringify(idx), "application/json");
  console.error(`web artifact: ${files.length} files at /${base}/`);
}

const issued_at = new Date().toISOString();
for (const band of bands) {
  const body = JSON.stringify({
    schema_version: "1.0", app_id: APP_ID, shell_major: SHELL_MAJOR, band, release, issued_at,
    core: { version: `1.0.${release}`, sha256: newSha, size: bytes.length, url: `b/${APP_ID}/${name}`, patches },
    addons: [], screens: [], min_shell_version: args["min-shell"] || MIN_SHELL,
    ...(web ? { web } : {}),
  });
  const envelope = JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) });
  await kvPut(`p/${APP_ID}/${SHELL_MAJOR}/${band}`, envelope, "application/json");
}
// Keep a small history record so rollback knows each release's shell requirement.
await kvPut(`h/${APP_ID}/r${release}`, JSON.stringify({ release, issued_at, sha256: sha256Hex(bytes), size: bytes.length, min_shell_version: args["min-shell"] || MIN_SHELL, web }), "application/json");
console.log(JSON.stringify({ release, bands, bytes: bytes.length, file, issued_at, web, patches: patches.map((p) => ({ from: p.from_sha256.slice(0, 12), kb: +(p.size / 1024).toFixed(1) })) }));
