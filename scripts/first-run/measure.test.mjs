import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { table } from "./measure.mjs";

const script = fileURLToPath(new URL("./measure.mjs", import.meta.url));
const fake = (body) => {
  const d = mkdtempSync(join(tmpdir(), "fake-cli-"));
  const f = join(d, "cli.js");
  writeFileSync(f, body);
  return { cli: f, out: join(d, "first-run.json") };
};
const run = ({ cli, out }) => spawnSync(process.execPath, [script, "--cli", cli, "--out", out], { encoding: "utf8" });

test("passes when every step exits 0, writes json and a table", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => [x.step, x.exit]), [["init", 0], ["doctor", 0], ["publish --dry-run", 0], ["total", 0]]);
  assert.ok(j.every((x) => Number.isInteger(x.ms)));
  assert.match(r.stdout, /\| init \| \d+\.\d\d \|/);
  assert.match(r.stdout, /\| total \| \d+\.\d\d \|/);
});

test("a failing step exits non-zero and shows its stderr", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true}); else { console.error("boom: no seed"); process.exit(3); }`);
  const r = run(f);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /boom: no seed/);
  assert.equal(JSON.parse(readFileSync(f.out, "utf8"))[1].exit, 3);
});

test("a failing doctor stops the run and prints doctor's own output", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true}); else if (process.argv[2]==="doctor") { console.log("FAIL signing key — fix: x"); process.exit(1); }`);
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL signing key/);
  assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).map((x) => [x.step, x.exit]), [["init", 0], ["doctor", 1], ["total", 1]]);
});

test("a failing init stops the run", () => {
  const f = fake(`console.error("init broke"); process.exit(1);`);
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /init broke/);
  assert.equal(JSON.parse(readFileSync(f.out, "utf8")).length, 2);
});

test("table renders seconds and a total from fake timings", () => {
  const rows = [{ step: "init", ms: 1500, exit: 0 }, { step: "install", ms: 42250, exit: 0 }, { step: "publish", ms: 8000, exit: 0 }];
  assert.equal(table(rows, 52000), ["| step | seconds |", "| --- | ---: |", "| init | 1.50 |", "| install | 42.25 |", "| publish | 8.00 |", "| total | 52.00 |"].join("\n"));
  assert.equal(table(rows).split("\n").pop(), "| total | 51.75 |");
});

test("--with-export without install and control url fails with a clear message", () => {
  const f = fake(`process.exit(0);`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-export"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--with-export needs --with-install and --control-url/);
});

test("without --with-install, no install step", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "doctor", "publish --dry-run", "total"]);
  assert.doesNotMatch(r.stdout, /\| install \|/);
  assert.doesNotMatch(r.stdout, /package manager:/);
});

test("with --with-install, install step is included", () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
  const pnpm = join(bindir, "pnpm");
  writeFileSync(pnpm, "#!/bin/sh\necho 9.9.9\nexit 0\n");
  chmodSync(pnpm, 0o755);
  const npm = join(bindir, "npm");
  writeFileSync(npm, "#!/bin/sh\nexit 0\n");
  chmodSync(npm, 0o755);
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + dirname(process.execPath) },
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "install", "doctor", "publish --dry-run", "total"]);
  assert.match(r.stdout, /\| install \|/);
  assert.match(r.stdout, /package manager: pnpm 9\.9\.9/);
});

test("a failing install stops the run and shows its stderr", () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
  const pnpm = join(bindir, "pnpm");
  writeFileSync(pnpm, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 9.9.9; exit 0; fi\necho boom: install failed >&2\nexit 1\n");
  chmodSync(pnpm, 0o755);
  const npm = join(bindir, "npm");
  writeFileSync(npm, "#!/bin/sh\nexit 0\n");
  chmodSync(npm, 0o755);
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + dirname(process.execPath) },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /boom: install failed/);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "install", "total"]);
});

test("with --with-install, a failing init runs no install", () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
  const pnpm = join(bindir, "pnpm");
  writeFileSync(pnpm, "#!/bin/sh\necho 9.9.9\nexit 0\n");
  chmodSync(pnpm, 0o755);
  const f = fake(`console.error("init broke"); process.exit(1);`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + dirname(process.execPath) },
  });
  assert.notEqual(r.status, 0);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "total"]);
});

// A tiny control plane: POST /apps, PUT /apps/:id/kv/*, GET /p/*, DELETE /apps/:id.
async function stub({ putStatus = 200, badSig = false } = {}) {
  const kv = new Map(), log = [];
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      log.push(`${req.method} ${req.url}`);
      const send = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(typeof o === "string" ? o : JSON.stringify(o)); };
      if (req.method === "POST" && req.url === "/apps") return req.headers.authorization === "Bearer sv_test_localdev" ? send(201, { publish_token: "tok123" }) : send(401, { error: "bad dev key" });
      if (req.method === "PUT" && req.url.startsWith("/apps/")) {
        if (req.headers.authorization !== "Bearer tok123") return send(401, { error: "no" });
        if (putStatus !== 200) return send(putStatus, { message: "quota exceeded on purpose" });
        kv.set(decodeURIComponent(req.url.split("/kv/")[1]), b); return send(200, { ok: true });
      }
      if (req.method === "GET" && req.url.startsWith("/p/")) { const v = kv.get(req.url.slice(1)); return v ? send(200, badSig ? v.replace(/"signature":"[^"]*"/, '"signature":"AAAA"') : v) : send(404, { error: "none" }); }
      if (req.method === "GET" && req.url.startsWith("/apps/")) return send(404, {});
      send(200, {});
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, log, close: () => srv.close() };
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubB64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const fakeCp = () => fake(`
import {mkdirSync, writeFileSync, readFileSync, appendFileSync} from "node:fs";
import {createPrivateKey, sign} from "node:crypto";
const a = process.argv;
if (a[2]==="publish" && process.env.ARGS_LOG) appendFileSync(process.env.ARGS_LOG, JSON.stringify(a.slice(2))+"\\n");
if (a[2]==="init") { mkdirSync(a[3],{recursive:true}); writeFileSync(a[3]+"/shipvo.json", JSON.stringify({appId:"demo", controlPlane:"https://x.invalid", publicKey:${JSON.stringify(pubB64)}})); }
if (a[2]==="publish" && !a.includes("--dry-run")) {
  const cfg = JSON.parse(readFileSync("shipvo.json","utf8"));
  const body = JSON.stringify({app_id:"demo", release:1});
  const key = createPrivateKey(${JSON.stringify(privateKey.export({ format: "pem", type: "pkcs8" }))});
  const r = await fetch(cfg.controlPlane+"/apps/demo/kv/p/demo/1/b0", {method:"PUT", headers:{authorization:"Bearer "+process.env.SHIPVO_PUBLISH_TOKEN}, body: JSON.stringify({body, signature: sign(null, Buffer.from(body), key).toString("base64")})});
  if (!r.ok) { console.error("publish p/demo/1/b0: "+r.status+" "+(await r.json()).message); process.exit(1); }
  console.log(JSON.stringify({app:"demo", release:1}));
}`);
const runAsync = ({ cli, out }, extra, env = {}) => new Promise((done) => {
  const c = spawn(process.execPath, [script, "--cli", cli, "--out", out, ...extra], { env: { ...process.env, SHIPVO_LOCAL_DEV_KEY: "sv_test_localdev", ...env } });
  let so = "", se = "";
  c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
  c.on("close", (status) => done({ status, stdout: so, stderr: se }));
});

test("--control-url runs a real publish and checks the signed pointer", async () => {
  const s = await stub(); const f = fakeCp();
  try {
    const r = await runAsync(f, ["--control-url", s.url]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(f.out, "utf8"));
    assert.deepEqual(j.map((x) => [x.step, x.exit]), [["init", 0], ["doctor", 0], ["publish --dry-run", 0], ["publish", 0], ["pointer", 0], ["total", 0]]);
    assert.ok(j.every((x) => Number.isInteger(x.ms)));
    assert.match(r.stdout, /\| publish \| \d+\.\d\d \|/);
    assert.ok(s.log.includes("DELETE /apps/demo"));
  } finally { s.close(); }
});

test("--control-url: a non-2xx publish exits 1 and prints the server's message", async () => {
  const s = await stub({ putStatus: 429 }); const f = fakeCp();
  try {
    const r = await runAsync(f, ["--control-url", s.url]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /quota exceeded on purpose/);
    const j = JSON.parse(readFileSync(f.out, "utf8"));
    assert.deepEqual(j.slice(3).map((x) => [x.step, x.exit]), [["publish", 1], ["total", 1]]);
  } finally { s.close(); }
});

test("--control-url: an unsigned pointer fails the pointer check", async () => {
  const s = await stub({ badSig: true }); const f = fakeCp();
  try {
    const r = await runAsync(f, ["--control-url", s.url]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not signed/);
    assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).slice(3).map((x) => [x.step, x.exit]), [["publish", 0], ["pointer", 1], ["total", 1]]);
  } finally { s.close(); }
});

const fakePm = () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pm-"));
  for (const n of ["pnpm", "npm"]) { writeFileSync(join(bindir, n), "#!/bin/sh\necho 9.9.9\nexit 0\n"); chmodSync(join(bindir, n), 0o755); }
  return bindir + ":" + dirname(process.execPath);
};
const publishCalls = (log) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("--with-export runs the real publish without --skip-export and records a publish row", async () => {
  const s = await stub(); const f = fakeCp(); const log = join(dirname(f.out), "args.log");
  try {
    const r = await runAsync(f, ["--with-install", "--with-export", "--control-url", s.url], { ARGS_LOG: log, PATH: fakePm() });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(f.out, "utf8"));
    assert.deepEqual(j.map((x) => [x.step, x.exit]), [["init", 0], ["install", 0], ["doctor", 0], ["publish (includes export)", 0], ["pointer", 0], ["total", 0]]);
    const calls = publishCalls(log);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes("--skip-export"));
    assert.match(r.stdout, /\| publish \(includes export\) \| \d+\.\d\d \|/);
  } finally { s.close(); }
});

test("without --with-export, the real publish still passes --skip-export true", async () => {
  const s = await stub(); const f = fakeCp(); const log = join(dirname(f.out), "args.log");
  try {
    const r = await runAsync(f, ["--control-url", s.url], { ARGS_LOG: log });
    assert.equal(r.status, 0, r.stderr);
    const calls = publishCalls(log);
    assert.ok(calls.some((c) => !c.includes("--dry-run") && c.join(" ").includes("--skip-export true")));
  } finally { s.close(); }
});
