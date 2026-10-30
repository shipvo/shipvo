#!/usr/bin/env node
// Build the JS bundle (Hermes bytecode), sign a release pointer and publish both to the control plane's KV.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PURENATIVE_SIGNING_SEED (or PURENATIVE_SIGNING_SEED_FILE),
//      PURENATIVE_KV_ID (defaults to the control plane's POINTERS namespace).
// Usage: node scripts/publish-ota.mjs [--bands b0,b1,b2] [--release N] [--min-shell 1.0.0] [--skip-export]
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { signBytes, sha256Hex } from "@purenative/cli";

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

const issued_at = new Date().toISOString();
for (const band of bands) {
  const body = JSON.stringify({
    schema_version: "1.0", app_id: APP_ID, shell_major: SHELL_MAJOR, band, release, issued_at,
    core: { version: `1.0.${release}`, sha256: sha256Hex(bytes), size: bytes.length, url: `b/${APP_ID}/${name}` },
    addons: [], screens: [], min_shell_version: args["min-shell"] || MIN_SHELL,
  });
  const envelope = JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) });
  await kvPut(`p/${APP_ID}/${SHELL_MAJOR}/${band}`, envelope, "application/json");
}
console.log(JSON.stringify({ release, bands, bytes: bytes.length, file, issued_at }));
