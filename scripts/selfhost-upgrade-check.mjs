#!/usr/bin/env node
// Proves data survived a restart or upgrade of a local control plane (docker compose, or wrangler dev).
//   node scripts/selfhost-upgrade-check.mjs seed <baseUrl>     register an app, publish a signed pointer, save it to a file
//   node scripts/selfhost-upgrade-check.mjs verify <baseUrl>   check the control plane still serves that same pointer
// Exits 0 on success, 1 on any failure.
// env: SHIPVO_LOCAL_DEV_KEY (default sv_test_localdev), UPGRADE_CHECK_FILE (default ./selfhost-upgrade-check.json)
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export class CheckError extends Error {}

const clean = (u) => String(u).replace(/\/$/, "");

async function call(fetchFn, base, method, path, token, body, raw) {
  const r = await fetchFn(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(raw ? {} : { "content-type": "application/json" }) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

export async function seed({ baseUrl, file, devKey = "sv_test_localdev", fetchFn = fetch, log = console.log }) {
  const base = clean(baseUrl);
  const appId = `upgrade-${randomBytes(3).toString("hex")}`;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const created = await call(fetchFn, base, "POST", "/apps", devKey, { app_id: appId, name: "Upgrade check", public_key: rawPub });
  if (created.status !== 201 || !created.json?.publish_token) throw new CheckError(`create app: HTTP ${created.status} ${created.text}`);
  log(`ok: created app ${appId}`);
  const sha = "a".repeat(64);
  const body = JSON.stringify({ schema_version: "1.0", app_id: appId, shell_major: 1, band: "b0", release: 1, issued_at: new Date().toISOString(),
    core: { version: "1.0.0", sha256: sha, size: 1, url: `/b/${appId}/core.hbc` }, addons: [], screens: [], min_shell_version: "1.0.0" });
  const pointer = JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString("base64") });
  const put = await call(fetchFn, base, "PUT", `/apps/${appId}/kv/p/${appId}/1/b0`, created.json.publish_token, null, pointer);
  if (put.status !== 200) throw new CheckError(`publish pointer: HTTP ${put.status} ${put.text}`);
  log("ok: published a signed pointer");
  await writeFile(file, JSON.stringify({ appId, pointer }, null, 2) + "\n");
  log(`ok: saved ${file}`);
  return { appId, pointer };
}

export async function verify({ baseUrl, file, fetchFn = fetch, log = console.log }) {
  const base = clean(baseUrl);
  let saved;
  try { saved = JSON.parse(await readFile(file, "utf8")); } catch (e) { throw new CheckError(`cannot read ${file}: run "seed" first (${e.message})`); }
  const { appId, pointer } = saved;
  if (typeof appId !== "string" || typeof pointer !== "string") throw new CheckError(`${file} must hold {appId, pointer}`);
  let got;
  try { got = await fetchFn(`${base}/p/${appId}/1/b0`); } catch (e) { throw new CheckError(`cannot reach ${base}: ${e.cause?.code ?? e.message}`); }
  const text = await got.text();
  if (got.status === 404) throw new CheckError(`data lost: ${base} has no pointer for app ${appId} (HTTP 404). The volume may be empty or new.`);
  if (got.status !== 200) throw new CheckError(`read pointer: HTTP ${got.status} ${text}`);
  if (text !== pointer) throw new CheckError(`pointer for ${appId} differs from the one seeded`);
  log(`ok: ${base} still serves the pointer for ${appId}`);
}

async function main(argv, env) {
  const [mode, url] = argv;
  if (!["seed", "verify"].includes(mode) || !url) throw new CheckError("usage: selfhost-upgrade-check.mjs seed|verify <baseUrl>");
  const file = env.UPGRADE_CHECK_FILE ?? "selfhost-upgrade-check.json";
  if (mode === "seed") await seed({ baseUrl: url, file, devKey: env.SHIPVO_LOCAL_DEV_KEY ?? "sv_test_localdev" });
  else await verify({ baseUrl: url, file });
  console.log("PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch((e) => { console.error(`FAIL: ${e instanceof CheckError ? e.message : e}`); process.exit(1); });
}
