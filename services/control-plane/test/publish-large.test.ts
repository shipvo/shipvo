// Runs the real `shipvo publish` (built CLI) against the control plane app on a local port with a ~2 MB random bundle (#395).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";

const cliRoot = resolve(__dirname, "../../../packages/cli");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN = "sv_publish_largebundletest";
const seedBytes = Buffer.alloc(32, 7);
const pubB64 = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seedBytes]), format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const store = new Map<string, ArrayBuffer>();
const POINTERS = {
  get: async (k: string, type?: string) => { const v = store.get(k); if (!v) return null; return type === "arrayBuffer" ? v : new TextDecoder().decode(v); },
  put: async (k: string, v: ArrayBuffer) => { store.set(k, v); },
  list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
};
const DB = { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
  first: async () => {
    if (sql.includes("FROM publish_tokens")) return args[0] === sha(TOKEN) ? { id: 1, expires_at: null } : null;
    if (sql.includes("FROM apps")) return { public_key: pubB64, bytes_used: 0 };
    return null;
  },
  run: async () => ({}),
  all: async () => ({ results: [] }),
}) }) } as any;
const env = { DB, POINTERS } as any;

let server: Server, out = "", dir = "", url = "";
const bundle = randomBytes(2 * 1024 * 1024);
bundle.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await app.fetch(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as any, body: body && req.method !== "GET" ? body : undefined }), env);
    res.statusCode = r.status; r.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  out = mkdtempSync(join(cliRoot, "dist-test-"));
  const tsc = createRequire(join(cliRoot, "package.json")).resolve("typescript/bin/tsc");
  const b = spawnSync(process.execPath, [tsc, "-p", join(cliRoot, "tsconfig.json"), "--outDir", out], { encoding: "utf8" });
  expect(b.status, b.stdout + b.stderr).toBe(0);
  dir = mkdtempSync(join(tmpdir(), "shipvo-large-"));
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
  writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "large-app", controlPlane: url, publicKey: pubB64 }));
  mkdirSync(join(dir, "dist-ota/_expo/static/js/android"), { recursive: true });
  writeFileSync(join(dir, "dist-ota/_expo/static/js/android/index.hbc"), bundle);
}, 120_000);
afterAll(() => { server?.close(); if (out) rmSync(out, { recursive: true, force: true }); if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("shipvo publish of a ~2 MB bundle against the control plane", () => {
  it("uploads the bundle and the control plane serves a signed pointer for it", async () => {
    const r = await new Promise<{ code: number; stderr: string }>((done) => {
      execFile(process.execPath, [join(out, "cli.js"), "publish", "--skip-export", "true", "--skip-web", "true", "--platform", "android", "--bands", "b0"], {
        cwd: dir, env: { ...process.env, SHIPVO_HOME: dir, SHIPVO_SIGNING_SEED: seedBytes.toString("base64"), SHIPVO_PUBLISH_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "", SHIPVO_DEBUG: "" },
      }, (e, _o, stderr) => done({ code: e ? (e as any).code : 0, stderr }));
    });
    expect(r.stderr).not.toContain("Cannot reach");
    expect(r.code, r.stderr).toBe(0);
    expect(store.get("b/large-app/r1.hbc")?.byteLength).toBe(bundle.length);
    const p = await fetch(`${url}/apps/large-app/kv/p/large-app/1/b0`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(p.status).toBe(200);
    const envl: any = await p.json();
    const body = JSON.parse(envl.body);
    expect(body).toMatchObject({ app_id: "large-app", release: 1, band: "b0" });
    expect(typeof envl.signature).toBe("string");
  }, 60_000);
});
