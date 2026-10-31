import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** shipvo.json at the app root: what `shipvo init` writes and every other command reads. */
export type ShipvoConfig = {
  appId: string;
  name: string;
  shellMajor: number;
  /** Control plane the shell trusts (also in app.json's @shipvo/runtime plugin props). */
  controlPlane: string;
  /** Base64 Ed25519 public key built into the shell. */
  publicKey: string;
  /** Where `shipvo publish` writes: the control plane's Cloudflare KV namespace. */
  kv?: { namespaceId: string };
  /** Marketplace listing (hosted control plane): shown to agents and on shipvo.dev once reviewed. */
  listing?: { public?: boolean; description?: string; category?: string; tagline?: string; icon?: string; screenshots?: string[]; website?: string; capabilities?: string[] };
};

export function loadConfig(dir = process.cwd()): ShipvoConfig {
  const p = join(dir, "shipvo.json");
  if (!existsSync(p)) throw new Error("No shipvo.json here. Run this inside an app created with `shipvo init`, or create one (see docs/getting-started.md).");
  const c = JSON.parse(readFileSync(p, "utf8"));
  for (const k of ["appId", "controlPlane", "publicKey"]) if (!c[k]) throw new Error(`shipvo.json: "${k}" is required`);
  return { shellMajor: 1, name: c.appId, ...c };
}

const argPairs = (argv: string[]) => Object.fromEntries(argv.reduce<string[][]>((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1] === undefined || all[i + 1].startsWith("--") ? "true" : all[i + 1]]] : a), []));
export const args = (argv: string[]) => argPairs(argv) as Record<string, string | undefined>;

/** Signing seed: SHIPVO_SIGNING_SEED (PURENATIVE_SIGNING_SEED still accepted) or a *_FILE path. */
export function seed(): string {
  const e = process.env;
  const s = e.SHIPVO_SIGNING_SEED || e.PURENATIVE_SIGNING_SEED
    || ((e.SHIPVO_SIGNING_SEED_FILE || e.PURENATIVE_SIGNING_SEED_FILE) && readFileSync((e.SHIPVO_SIGNING_SEED_FILE || e.PURENATIVE_SIGNING_SEED_FILE)!, "utf8").trim());
  const local = (() => { try { return readFileSync(join(process.cwd(), ".shipvo", "seed.txt"), "utf8").trim(); } catch { return ""; } })();   // what `shipvo init` wrote
  if (!s && local) return local;
  if (!s) { console.error("Set SHIPVO_SIGNING_SEED or SHIPVO_SIGNING_SEED_FILE (the seed `shipvo keygen` printed), or keep it at .shipvo/seed.txt."); process.exit(2); }
  return s;
}

/** The publish token `shipvo app create` issued: SHIPVO_PUBLISH_TOKEN (CI) or .shipvo/publish-token. */
export function publishToken(): string | null {
  if (process.env.SHIPVO_PUBLISH_TOKEN) return process.env.SHIPVO_PUBLISH_TOKEN.trim();
  try { return readFileSync(join(process.cwd(), ".shipvo", "publish-token"), "utf8").trim() || null; } catch { return null; }
}

/** Publishing through the hosted control plane: the same get/put/keys, scoped to this app and signed-pointer checked server side. */
function hostedKv(cfg: ShipvoConfig, token: string) {
  const base = `${cfg.controlPlane.replace(/\/$/, "")}/apps/${cfg.appId}/kv`;
  const auth = { Authorization: `Bearer ${token}` };
  const path = (k: string) => `${base}/${k.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async get(k: string) { const r = await fetch(path(k), { headers: auth }); if (r.status === 401) throw new Error("publish token rejected: run `shipvo app create` for a new one"); return r.ok ? r.text() : null; },
    async getBytes(k: string) { const r = await fetch(path(k), { headers: auth }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; },
    async keys(prefix: string) { const r = await fetch(`${base}?prefix=${encodeURIComponent(prefix)}`, { headers: auth }); return r.ok ? ((await r.json()) as any).keys as string[] : []; },
    async put(k: string, body: BodyInit, type: string) {
      const r = await fetch(path(k), { method: "PUT", headers: { ...auth, "content-type": type }, body });
      if (!r.ok) { let m = ""; try { const j: any = await r.json(); m = j.message ?? j.error; } catch {} throw new Error(`publish ${k}: ${r.status} ${m}`); }
    },
  };
}

/** Where publish/rollback write: your own Cloudflare KV (self-hosted control plane) or the hosted control plane with a publish token. */
export function kv(cfg: ShipvoConfig) {
  const ACC = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const NS = process.env.SHIPVO_KV_ID || process.env.PURENATIVE_KV_ID || cfg.kv?.namespaceId;
  if (!(ACC && TOKEN && NS)) {
    const pt = publishToken(); if (pt) return hostedKv(cfg, pt);
    console.error("Nothing to publish with. Hosted: run `shipvo login`, then `shipvo app create` (or set SHIPVO_PUBLISH_TOKEN). Self-hosted: set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and SHIPVO_KV_ID."); process.exit(2);
  }
  const url = (k: string) => `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${NS}/values/${encodeURIComponent(k)}`;
  const auth = { Authorization: `Bearer ${TOKEN}` };
  return {
    async get(k: string) { const r = await fetch(url(k), { headers: auth }); return r.ok ? r.text() : null; },
    async getBytes(k: string) { const r = await fetch(url(k), { headers: auth }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; },
    async keys(prefix: string) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${NS}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`, { headers: auth });
      return r.ok ? ((await r.json()) as any).result.map((k: any) => k.name as string) : [];
    },
    async put(k: string, body: BodyInit, type: string) {
      const r = await fetch(url(k), { method: "PUT", headers: { ...auth, "content-type": type }, body });
      if (!r.ok) throw new Error(`KV put ${k}: ${r.status} ${await r.text()}`);
    },
  };
}
