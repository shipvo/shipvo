// POST /session with a build_url: opens the uploaded build, replies with its id, and leaves no session on an error.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(11000, 300);
const root = mkdtempSync(join(tmpdir(), "sim-build-open-"));
let proc, files, base;
const page = (t) => `<!doctype html><html><head><title>b</title></head><body><h1>${t}</h1></body></html>`;
const pack = (name, html) => { const d = join(root, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), html); const out = join(root, `${name}.tgz`); spawnSync("tar", ["-czf", out, "-C", d, "."]); return readFileSync(out); };
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  const good = pack("good", page("Uploaded build"));
  files = createServer((req, res) => {
    if (req.url === "/good.tgz") return res.end(good);
    if (req.url === "/big.tgz") return res.end(Buffer.alloc(5000, 1));
    if (req.url === "/junk.tgz") return res.end("not an archive");
    res.writeHead(404).end();
  });
  await new Promise((r) => files.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${files.address().port}`;
  const dist = join(root, "dist"); mkdirSync(dist); writeFileSync(join(dist, "index.html"), page("Local build"));
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here, env: { ...process.env, PN_BUILD_ALLOW_HOSTS: "127.0.0.1", PN_BUILD_MAX_BYTES: "4000" } });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error("sim exited"); await new Promise((r) => setTimeout(r, 200)); } }
  assert.ok(up, "sim did not start");
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); files?.closeAllConnections(); files?.close(); rmSync(root, { recursive: true, force: true });
});

for (const platform of ["android", "ios"]) {
  test(`${platform}: a session opens the uploaded build and replies with its id`, async () => {
    const r = await call("/session", { session: `b-${platform}`, app: "tide", build_url: `${base}/good.tgz`, build: "up1", phone: { platform } });
    assert.equal(r.ok, true);
    assert.equal(r.build, "up1");
    assert.match(r.screen, /Uploaded build/);
    assert.equal(r.release, "build:up1");
    const s = await call("/sessions", {});
    assert.ok(s.sessions.some((x) => x.session === `b-${platform}`));
  });
}

test("without a build id the reply carries the content id", async () => {
  const r = await call("/session", { session: "b-plain", app: "tide", build_url: `${base}/good.tgz` });
  assert.match(r.build, /^[0-9a-f]{64}$/);
});

test("a session without build_url has no build in the reply", async () => {
  const r = await call("/session", { session: "b-local", app: "tide" });
  assert.equal(r.ok, true); assert.equal(r.build, undefined); assert.match(r.screen, /Local build/);
});

for (const [name, url, code] of [
  ["bad url", "ftp://x/y", "bad_url"],
  ["private host", "http://10.0.0.5/x.tgz", "host_not_allowed"],
  ["unreachable", "http://127.0.0.1:1/x.tgz", "unreachable"],
  ["not found", "__BASE__/missing.tgz", "unreachable"],
  ["oversize", "__BASE__/big.tgz", "too_large"],
  ["not an archive", "__BASE__/junk.tgz", "bad_build"],
]) {
  test(`${name}: typed error and no session`, async () => {
    const id = `e-${name.replace(/ /g, "-")}`;
    const r = await call("/session", { session: id, app: "tide", build_url: url.replace("__BASE__", base) });
    assert.equal(r.ok, false); assert.equal(r.code, code);
    const s = await call("/sessions", {});
    assert.ok(!s.sessions.some((x) => x.session === id));
  });
}
