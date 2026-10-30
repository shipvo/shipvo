#!/usr/bin/env node
// Fleet rollback: republish an earlier release's bundle as a NEW release number, so every device moves to it.
// Devices only accept releases newer than what they have, so rollback is "roll forward to old code".
// Usage: node scripts/rollback-ota.mjs --to <release> [--bands b0,b1,b2]
import { readFileSync } from "node:fs";
import { signBytes, sha256Hex } from "@liveo/cli";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const APP_ID = "tide", SHELL_MAJOR = 1;
const ACC = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV = process.env.PURENATIVE_KV_ID || "c0851feca4c5486d8ed844d16f0b36df";
const SEED = process.env.PURENATIVE_SIGNING_SEED || (process.env.PURENATIVE_SIGNING_SEED_FILE && readFileSync(process.env.PURENATIVE_SIGNING_SEED_FILE, "utf8").trim());
const to = Number(args.to);
if (!ACC || !TOKEN || !SEED || !to) { console.error("Need --to <release> and CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, signing seed"); process.exit(1); }
const bands = (args.bands || "b0,b1,b2").split(",");
const kvUrl = (k) => `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(k)}`;
const auth = { Authorization: `Bearer ${TOKEN}` };

const bundle = await fetch(kvUrl(`b/${APP_ID}/r${to}.hbc`), { headers: auth });
if (!bundle.ok) { console.error(`Release ${to} bundle not found`); process.exit(1); }
const bytes = new Uint8Array(await bundle.arrayBuffer());

// Find the target release's min shell and the highest current release.
let max = 0, minShell = "1.0.0";
for (const b of ["b0", "b1", "b2"]) {
  const r = await fetch(kvUrl(`p/${APP_ID}/${SHELL_MAJOR}/${b}`), { headers: auth });
  if (r.ok) try { max = Math.max(max, JSON.parse(JSON.parse(await r.text()).body).release); } catch {}
}
const hist = await fetch(kvUrl(`h/${APP_ID}/r${to}`), { headers: auth });
if (hist.ok) try { minShell = JSON.parse(await hist.text()).min_shell_version || minShell; } catch {}

const release = max + 1, issued_at = new Date().toISOString();
for (const band of bands) {
  const body = JSON.stringify({
    schema_version: "1.0", app_id: APP_ID, shell_major: SHELL_MAJOR, band, release, issued_at,
    core: { version: `1.0.${release}`, sha256: sha256Hex(bytes), size: bytes.length, url: `b/${APP_ID}/r${to}.hbc` },
    addons: [], screens: [], min_shell_version: minShell,
  });
  const envelope = JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), SEED) });
  const r = await fetch(kvUrl(`p/${APP_ID}/${SHELL_MAJOR}/${band}`), { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: envelope });
  if (!r.ok) throw new Error(`KV put failed: ${r.status}`);
}
console.log(JSON.stringify({ rolled_back_to_code_of: to, new_release: release, bands, min_shell_version: minShell, issued_at }));
