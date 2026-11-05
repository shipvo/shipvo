#!/usr/bin/env node
// Smoke test for a local control plane (docker compose up, or wrangler dev).
// Waits for /health, registers an app, publishes a signed pointer, reads it back. Exits 1 on any failure.
// Usage: node scripts/selfhost-smoke.mjs [baseUrl]    env: SHIPVO_LOCAL_DEV_KEY (default sv_test_localdev), SMOKE_TIMEOUT_S (default 120)
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";

const base = (process.argv[2] ?? process.env.SHIPVO_CONTROL_URL ?? "http://localhost:8787").replace(/\/$/, "");
const devKey = process.env.SHIPVO_LOCAL_DEV_KEY ?? "sv_test_localdev";
const timeoutS = Number(process.env.SMOKE_TIMEOUT_S ?? 120);

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const step = (msg) => console.log(`ok: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth() {
  const end = Date.now() + timeoutS * 1000;
  let last = "no answer";
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.status === 200) { const j = await r.json(); if (j.ok === true) return j; last = "body had no ok:true"; } else last = `HTTP ${r.status}`;
    } catch (e) { last = String(e.cause?.code ?? e.message); }
    await sleep(1000);
  }
  fail(`${base}/health not ready after ${timeoutS}s (${last})`);
}

async function call(method, path, token, body, raw) {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(raw ? {} : { "content-type": "application/json" }) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

await waitForHealth();
step("/health returned 200 with ok:true");

const appId = `smoke-${randomBytes(3).toString("hex")}`;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const created = await call("POST", "/apps", devKey, { app_id: appId, name: "Smoke test", public_key: rawPub });
if (created.status !== 201 || !created.json?.publish_token) fail(`create app: HTTP ${created.status} ${created.text}`);
step(`created app ${appId}`);
const token = created.json.publish_token;

const sha = "a".repeat(64);
const body = JSON.stringify({ schema_version: "1.0", app_id: appId, shell_major: 1, band: "b0", release: 1, issued_at: new Date().toISOString(),
  core: { version: "1.0.0", sha256: sha, size: 1, url: `/b/${appId}/core.hbc` }, addons: [], screens: [], min_shell_version: "1.0.0" });
const envelope = JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString("base64") });
const put = await call("PUT", `/apps/${appId}/kv/p/${appId}/1/b0`, token, null, envelope);
if (put.status !== 200) fail(`publish pointer: HTTP ${put.status} ${put.text}`);
step("published a signed pointer");

const got = await fetch(`${base}/p/${appId}/1/b0`);
const text = await got.text();
if (got.status !== 200) fail(`read pointer: HTTP ${got.status} ${text}`);
if (text !== envelope) fail("pointer read back differs from what was published");
step("read the pointer back");

await call("DELETE", `/apps/${appId}`, devKey);
console.log("PASS");
