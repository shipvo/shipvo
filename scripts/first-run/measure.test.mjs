import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { table, applyRow } from "./measure.mjs";

const script = fileURLToPath(new URL("./measure.mjs", import.meta.url));
const fake = (body) => {
  const d = mkdtempSync(join(tmpdir(), "fake-cli-"));
  const f = join(d, "cli.js");
  writeFileSync(f, body);
  return { cli: f, out: join(d, "first-run.json") };
};

// A fake `shipvo sim` that answers the two calls @shipvo/test makes to open an app.
const SIM = `if (process.argv[2]==="sim") { const {createServer}=await import("node:http"); createServer((q,r)=>{ q.resume(); q.on("end",()=>{ r.writeHead(200,{"content-type":"application/json"}); r.end(JSON.stringify({ok:true,screen:"- text: Welcome",release:"local"})); }); }).listen(Number(process.argv[process.argv.indexOf("--port")+1]),"127.0.0.1"); }`;
const INIT = `import {mkdirSync, writeFileSync} from "node:fs"; if (process.argv[2]==="init") { mkdirSync(process.argv[3],{recursive:true}); writeFileSync(process.argv[3]+"/shipvo.json", JSON.stringify({appId:"demo"})); }`;
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
  writeFileSync(join(bindir, "npx"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bindir, "npx"), 0o755);
  const f = fake(INIT + SIM);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install", "--with-session"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + dirname(process.execPath) },
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "install", "doctor", "publish --dry-run", "browser install", "first agent session", "total"]);
  assert.match(r.stdout, /\| install \|/);
  assert.match(r.stdout, /package manager: pnpm 9\.9\.9/);
  assert.match(r.stdout, /\| first agent session \| \d+\.\d\d \|/);
  assert.ok(j.every((x) => Number.isInteger(x.ms)));
});

test("the browser install runs in the app folder before the session step starts the simulator", () => {
  const f = fake(INIT + `import {appendFileSync} from "node:fs"; if (process.argv[2]==="sim") appendFileSync(process.env.ORDER_LOG, "sim\\n");` + SIM);
  const orderLog = join(dirname(f.out), "order.log");
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install", "--with-session"], { encoding: "utf8", env: { ...process.env, PATH: fakePm(), ORDER_LOG: orderLog } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(orderLog, "utf8").trim().split("\n"), ["npx playwright install chromium", "sim"]);
  assert.match(r.stdout, /\| browser install \| \d+\.\d\d \|/);
});

test("a failing browser install stops the run before the session", () => {
  const f = fake(INIT + SIM);
  const bin = mkdtempSync(join(tmpdir(), "fake-pm-"));
  for (const n of ["pnpm", "npm"]) { writeFileSync(join(bin, n), "#!/bin/sh\nexit 0\n"); chmodSync(join(bin, n), 0o755); }
  writeFileSync(join(bin, "npx"), "#!/bin/sh\necho download failed >&2\nexit 1\n"); chmodSync(join(bin, "npx"), 0o755);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install", "--with-session"], { encoding: "utf8", env: { ...process.env, PATH: bin + ":" + dirname(process.execPath) } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /download failed/);
  assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).map((x) => x.step).slice(-2), ["browser install", "total"]);
});

test("a first agent session that cannot start the simulator fails the run with its output", () => {
  const f = fake(INIT + `if (process.argv[2]==="sim") { console.error("sim broke: no chromium"); process.exit(2); }`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install", "--with-session"], { encoding: "utf8", env: { ...process.env, PATH: fakePm() } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sim broke: no chromium/);
  assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).map((x) => [x.step, x.exit]).slice(-2), [["first agent session", 1], ["total", 1]]);
});

test("--with-install without --with-session does not start the simulator", () => {
  const f = fake(INIT + `if (process.argv[2]==="sim") { console.error("sim must not run"); process.exit(2); }`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], { encoding: "utf8", env: { ...process.env, PATH: fakePm() } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!JSON.parse(readFileSync(f.out, "utf8")).some((x) => x.step === "first agent session"));
});

test("--with-session without --with-install is an error", () => {
  const f = fake(INIT);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-session"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--with-session needs --with-install/);
});

test("a simulator that never listens times out and fails the session step", async () => {
  const { firstAgentSession } = await import("./measure.mjs");
  const f = fake(`if (process.argv[2]==="sim") setInterval(()=>{},1000);`);
  const r = await firstAgentSession(f.cli, dirname(f.cli), 1500);
  assert.equal(r.exit, 1);
  assert.match(r.stderr, /did not start in time/);
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

test("a failing install prints the package manager's stdout too", () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
  const pnpm = join(bindir, "pnpm");
  writeFileSync(pnpm, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 9.9.9; exit 0; fi\necho ERR_PNPM_NO_MATCHING_VERSION on stdout\nexit 1\n");
  chmodSync(pnpm, 0o755);
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + dirname(process.execPath) },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /step "install" failed with exit 1:\nERR_PNPM_NO_MATCHING_VERSION on stdout/);
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
async function stub({ putStatus = 200, badSig = false, tamper = false } = {}) {
  const kv = new Map(), log = [];
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      log.push(`${req.method} ${req.url}`);
      const send = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(typeof o === "string" ? o : JSON.stringify(o)); };
      if (req.method === "POST" && req.url === "/apps") { try { log.push("APPID " + JSON.parse(b).app_id); } catch {} }
      if (req.method === "POST" && req.url === "/apps") return req.headers.authorization === "Bearer sv_test_localdev" ? send(201, { publish_token: "tok123" }) : send(401, { error: "bad dev key" });
      if (req.method === "PUT" && req.url.startsWith("/apps/")) {
        if (req.headers.authorization !== "Bearer tok123") return send(401, { error: "no" });
        if (putStatus !== 200) return send(putStatus, { message: "quota exceeded on purpose" });
        kv.set(decodeURIComponent(req.url.split("/kv/")[1]), b); return send(200, { ok: true });
      }
      if (req.method === "GET" && req.url.startsWith("/p/")) { const v = kv.get(req.url.slice(1)); return v ? send(200, badSig ? v.replace(/"signature":"[^"]*"/, '"signature":"AAAA"') : v) : send(404, { error: "none" }); }
      if (req.method === "GET" && req.url.startsWith("/b/")) { const v = kv.get(req.url.slice(1)); if (v === undefined) return send(404, { error: "none" }); res.writeHead(200); return res.end(tamper ? v + "x" : v); }
      if (req.method === "GET" && req.url.startsWith("/apps/")) return send(404, {});
      send(200, {});
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, log, close: () => srv.close() };
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubB64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const fakeCp = () => fake(SIM + `
import {mkdirSync, writeFileSync, readFileSync, appendFileSync} from "node:fs";
import {createPrivateKey, sign} from "node:crypto";
const a = process.argv;
if (a[2]==="publish" && process.env.ARGS_LOG) appendFileSync(process.env.ARGS_LOG, JSON.stringify(a.slice(2))+"\\n");
if (a[2]==="init") { mkdirSync(a[3],{recursive:true}); writeFileSync(a[3]+"/shipvo.json", JSON.stringify({appId:"demo", controlPlane:"https://x.invalid", publicKey:${JSON.stringify(pubB64)}})); }
if (a[2]==="publish" && !a.includes("--dry-run")) {
  const cfg = JSON.parse(readFileSync("shipvo.json","utf8"));
  const js = "console.log('first run');\\n";
  const bundle = await fetch(cfg.controlPlane+"/apps/"+cfg.appId+"/kv/b/"+cfg.appId+"/r1.js", {method:"PUT", headers:{authorization:"Bearer "+process.env.SHIPVO_PUBLISH_TOKEN}, body: js});
  const body = JSON.stringify({app_id:cfg.appId, release:1, core:{sha256: (await import("node:crypto")).createHash("sha256").update(js).digest("hex"), size: Buffer.byteLength(js), url:"b/"+cfg.appId+"/r1.js"}});
  const key = createPrivateKey(${JSON.stringify(privateKey.export({ format: "pem", type: "pkcs8" }))});
  const r = await fetch(cfg.controlPlane+"/apps/"+cfg.appId+"/kv/p/"+cfg.appId+"/1/b0", {method:"PUT", headers:{authorization:"Bearer "+process.env.SHIPVO_PUBLISH_TOKEN}, body: JSON.stringify({body, signature: sign(null, Buffer.from(body), key).toString("base64")})});
  if (!r.ok) { console.error("publish p/"+cfg.appId+"/1/b0: "+r.status+" "+(await r.json()).message); process.exit(1); }
  if (process.env.PLAIN_PUBLISH) console.error("Published release 1 to b0. Next: shipvo status.");
  else console.error(JSON.stringify({app:cfg.appId, release:1}));
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
    assert.deepEqual(j.map((x) => [x.step, x.exit]), [["init", 0], ["doctor", 0], ["publish --dry-run", 0], ["publish", 0], ["pointer", 0], ["bundle", 0], ["total", 0]]);
    assert.ok(j.every((x) => Number.isInteger(x.ms)));
    assert.match(r.stdout, /\| publish \| \d+\.\d\d \|/);
    const id = s.log.find((l) => l.startsWith("APPID ")).slice(6);
    assert.match(id, /^first-run-[a-z0-9]{6}$/);
    assert.ok(s.log.includes(`DELETE /apps/${id}`));
  } finally { s.close(); }
});

test("--control-url reads the release number from the plain-English publish line", async () => {
  const s = await stub(); const f = fakeCp();
  try {
    const r = await runAsync(f, ["--control-url", s.url], { PLAIN_PUBLISH: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).map((x) => [x.step, x.exit]).slice(3, 5), [["publish", 0], ["pointer", 0]]);
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
  writeFileSync(join(bindir, "npx"), `#!/bin/sh\n[ -n "$ORDER_LOG" ] && echo "npx $*" >> "$ORDER_LOG"\nexit 0\n`); chmodSync(join(bindir, "npx"), 0o755);
  return bindir + ":" + dirname(process.execPath);
};
const publishCalls = (log) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("--with-export runs the real publish without --skip-export and records a publish row", async () => {
  const s = await stub(); const f = fakeCp(); const log = join(dirname(f.out), "args.log");
  try {
    const r = await runAsync(f, ["--with-install", "--with-session", "--with-export", "--control-url", s.url], { ARGS_LOG: log, PATH: fakePm() });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(f.out, "utf8"));
    assert.deepEqual(j.map((x) => [x.step, x.exit]), [["init", 0], ["install", 0], ["doctor", 0], ["browser install", 0], ["first agent session", 0], ["publish (includes export)", 0], ["pointer", 0], ["bundle", 0], ["total", 0]]);
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

test("pickAppId is not reserved by the control plane", async () => {
  const { pickAppId } = await import("./measure.mjs");
  const src = readFileSync(fileURLToPath(new URL("../../services/control-plane/src/apps.ts", import.meta.url)), "utf8");
  const reserved = [...src.match(/const RESERVED = new Set\(\[(.*?)\]\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(reserved.includes("app"));
  const a = pickAppId();
  assert.match(a, /^first-run-[a-z0-9]{6}$/);
  assert.ok(!reserved.includes(a));
  assert.notEqual(a, pickAppId());
});

test("--control-log: a failed publish prints the last 20 lines of the control plane log", async () => {
  const s = await stub({ putStatus: 429 }); const f = fakeCp();
  const logFile = join(mkdtempSync(join(tmpdir(), "cp-log-")), "control-plane.log");
  writeFileSync(logFile, Array.from({ length: 30 }, (_, i) => `server line ${i + 1}`).join("\n") + "\n");
  try {
    const r = await runAsync(f, ["--control-url", s.url, "--control-log", logFile]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /quota exceeded on purpose/);
    assert.match(r.stderr, /server line 30/);
    assert.match(r.stderr, /server line 11\b/);
    assert.doesNotMatch(r.stderr, /server line 10\b/);
  } finally { s.close(); }
});

test("--control-log: a successful publish does not print the log", async () => {
  const s = await stub(); const f = fakeCp();
  const logFile = join(mkdtempSync(join(tmpdir(), "cp-log-")), "control-plane.log");
  writeFileSync(logFile, "server line 1\n");
  try {
    const r = await runAsync(f, ["--control-url", s.url, "--control-log", logFile]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /server line/);
  } finally { s.close(); }
});

test("applyRow maps the emulator figure and drops missing values", () => {
  assert.deepEqual(applyRow({ firstRun: { publishToHealthyMs: 4200.4, downloadMs: 800 } }), { step: "publish to healthy (full-bundle update scenario, emulator)", ms: 4200, exit: 0, downloadMs: 800 });
  assert.equal(applyRow({ firstRun: { publishToHealthyMs: 0 } }), null);
  assert.equal(applyRow({}), null);
});

const OK_CLI = `import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`;
const withReport = (path) => { const f = fake(OK_CLI); const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--apply-report", path], { encoding: "utf8" }); return { f, r }; };

test("--apply-report appends the emulator row after total, outside the total", () => {
  const rep = join(mkdtempSync(join(tmpdir(), "rep-")), "report.json");
  writeFileSync(rep, JSON.stringify({ firstRun: { publishToHealthyMs: 4200, downloadMs: 800, applyMs: 150 } }));
  const { f, r } = withReport(rep);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.slice(-2).map((x) => x.step), ["total", "publish to healthy (full-bundle update scenario, emulator)"]);
  assert.deepEqual(j.at(-1), { step: "publish to healthy (full-bundle update scenario, emulator)", ms: 4200, exit: 0, downloadMs: 800, applyMs: 150 });
  assert.ok(j.find((x) => x.step === "total").ms < 4200);
  assert.match(r.stdout, /publish to healthy \(full-bundle update scenario, emulator\): 4\.20 s/);
});

test("--apply-report with a missing or invalid file says why on stderr and prints not measured", () => {
  const dir = mkdtempSync(join(tmpdir(), "rep-"));
  const bad = join(dir, "bad.json"); writeFileSync(bad, "{nope");
  for (const [path, why] of [[join(dir, "missing.json"), /file not found/], [bad, /JSON/i]]) {
    const { f, r } = withReport(path);
    assert.equal(r.status, 0);
    assert.match(r.stderr, new RegExp("--apply-report .*" + path.split("/").pop()));
    assert.match(r.stderr, why);
    assert.match(r.stdout, /publish to healthy \(full-bundle update scenario, emulator\): not measured/);
    assert.equal(JSON.parse(readFileSync(f.out, "utf8")).at(-1).step, "total");
  }
});

test("--control-url: a tampered bundle fails the bundle step with a clear message", async () => {
  const s = await stub({ tamper: true }); const f = fakeCp();
  try {
    const r = await runAsync(f, ["--control-url", s.url]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /step "bundle" failed with exit 1:\nbundle: b\/first-run-[a-z0-9]{6}\/r1\.js is \d+ bytes, the signed pointer says \d+/);
    const j = JSON.parse(readFileSync(f.out, "utf8"));
    assert.deepEqual(j.slice(3).map((x) => [x.step, x.exit]), [["publish", 0], ["pointer", 0], ["bundle", 1], ["total", 1]]);
    assert.ok(Number.isInteger(j.find((x) => x.step === "bundle").ms));
  } finally { s.close(); }
});

test("bundleStep: same size but a different hash fails on sha256", async () => {
  const { bundleStep } = await import("./measure.mjs");
  const { createHash, createPublicKey, sign } = await import("node:crypto");
  const good = "aaaa";
  const srv = createServer((q, r) => r.end("bbbb"));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const body = { core: { url: "b/x/r1.js", size: 4, sha256: createHash("sha256").update(good).digest("hex") } };
    const text = JSON.stringify(body);
    const env = { body: text, signature: sign(null, Buffer.from(text), privateKey).toString("base64") };
    const r = await bundleStep(`http://127.0.0.1:${srv.address().port}`, env, body, createPublicKey(publicKey.export({ format: "pem", type: "spki" })));
    assert.equal(r.exit, 1);
    assert.match(r.stderr, /has sha256 .*, the signed pointer says/);
  } finally { srv.close(); }
});

test("--apply-report with a valid report but no firstRun timing says why on stderr", () => {
  const rep = join(mkdtempSync(join(tmpdir(), "rep-")), "report.json");
  writeFileSync(rep, JSON.stringify({ firstRun: null }));
  const { r } = withReport(rep);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /no firstRun timing/);
  assert.match(r.stdout, /not measured/);
});

// --template and the "app test" step
const fakePmTest = () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pm-"));
  const body = `#!/bin/sh\nif [ "$1" = run ]; then echo "$FAKE_TEST_OUT"; exit \${FAKE_TEST_EXIT:-0}; fi\necho 9.9.9\nexit 0\n`;
  for (const n of ["pnpm", "npm"]) { writeFileSync(join(bindir, n), body); chmodSync(join(bindir, n), 0o755); }
  return bindir + ":" + dirname(process.execPath);
};
const INIT_ARGS = `import {mkdirSync, appendFileSync} from "node:fs"; if (process.argv[2]==="init") { mkdirSync(process.argv[3],{recursive:true}); appendFileSync(process.env.ARGS_LOG, process.argv.slice(2).join(" ")+"\\n"); }`;

test("--template is passed to init; blank passes none", () => {
  for (const [args, want] of [[["--template", "shop"], /--template shop$/], [["--template", "content"], /--template content$/], [[], /^init \S+$/]]) {
    const f = fake(INIT_ARGS);
    const log = join(dirname(f.cli), "args.log");
    const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, ...args], { encoding: "utf8", env: { ...process.env, ARGS_LOG: log } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(log, "utf8").trim(), want);
  }
});

test("--with-test needs --with-install", () => {
  const f = fake(INIT);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-test"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--with-test needs --with-install/);
});

test("--with-test records an app test step that passes", () => {
  const f = fake(INIT + SIM);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install", "--with-test"], { encoding: "utf8", env: { ...process.env, PATH: fakePmTest() } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).map((x) => [x.step, x.exit]), [["init", 0], ["install", 0], ["doctor", 0], ["publish --dry-run", 0], ["app test", 0], ["total", 0]]);
});

test("a failing generated test exits 1 and prints the test output", () => {
  const f = fake(INIT + SIM);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install", "--with-test"], { encoding: "utf8", env: { ...process.env, PATH: fakePmTest(), FAKE_TEST_EXIT: "1", FAKE_TEST_OUT: "FAIL tests/app.test.ts the list shows every product" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /step "app test" failed/);
  assert.match(r.stderr, /FAIL tests\/app\.test\.ts the list shows every product/);
  assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")).map((x) => [x.step, x.exit]).slice(-2), [["app test", 1], ["total", 1]]);
});
