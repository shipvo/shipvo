import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..");
let out = "";
const seed = Buffer.alloc(32, 9).toString("base64");
let dir = "", server: Server, port = 0, status = 401;

const run = (controlPlane: string, env: Record<string, string>) => new Promise<{ status: number | null; stderr: string }>((done) => {
  writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "demo", controlPlane, publicKey: "k" }));
  const base = { ...process.env, SHIPVO_HOME: dir, SHIPVO_SIGNING_SEED: "", SHIPVO_SIGNING_SEED_FILE: "", SHIPVO_PUBLISH_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", SHIPVO_DEBUG: "" };
  execFile(process.execPath, [join(out, "cli.js"), "publish", "--skip-export", "true", "--skip-web", "true", "--bands", "b0"], { cwd: dir, env: { ...base, ...env } }, (e, _o, stderr) => done({ status: e ? (e as any).code : 0, stderr }));
});
const clean = (r: { stderr: string }) => expect(r.stderr).not.toMatch(/\n\s+at /);

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
  const b = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json"), "--outDir", out], { encoding: "utf8" });
  expect(b.status, b.stdout + b.stderr).toBe(0);
  dir = mkdtempSync(join(tmpdir(), "shipvo-first-"));
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
  mkdirSync(join(dir, "dist-ota/_expo/static/js/android"), { recursive: true });
  const hbc = new Uint8Array(64); hbc.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);
  writeFileSync(join(dir, "dist-ota/_expo/static/js/android/index.hbc"), hbc);
  server = createServer((_q, res) => { res.statusCode = status; res.end("{}"); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(() => { server?.close(); if (out) rmSync(out, { recursive: true, force: true }); if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("first shipvo publish failures", () => {
  it("no signing key: names shipvo keygen, exits 1", async () => {
    const r = await run(`http://127.0.0.1:${port}`, { SHIPVO_PUBLISH_TOKEN: "t" });
    expect(r.status).toBe(1); expect(r.stderr).toContain("shipvo keygen"); clean(r);
  });
  it("unreachable control plane: names the URL and shipvo doctor, exits 1", async () => {
    const r = await run("http://127.0.0.1:1", { SHIPVO_SIGNING_SEED: seed, SHIPVO_PUBLISH_TOKEN: "t" });
    expect(r.status).toBe(1); expect(r.stderr).toContain("Cannot reach the control plane at http://127.0.0.1:1"); expect(r.stderr).toContain("shipvo doctor"); clean(r);
  });
  it.each([401, 403])("rejected token (%i): names shipvo login, exits 1", async (s) => {
    status = s;
    const r = await run(`http://127.0.0.1:${port}`, { SHIPVO_SIGNING_SEED: seed, SHIPVO_PUBLISH_TOKEN: "bad" });
    expect(r.status).toBe(1); expect(r.stderr).toContain("shipvo login"); expect(r.stderr).toContain(String(s)); clean(r);
  });
});
