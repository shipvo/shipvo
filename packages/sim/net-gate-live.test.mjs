// set_device network off / airplane / offline profile against a real sim server: the app's fetch rejects and no order is sent.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(9700, 300);
const root = mkdtempSync(join(tmpdir(), "sim-gate-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc, backend, backendUrl; const orders = [];
const PAGE = `<!doctype html><html><head><title>shop</title></head><body><h1 id="h">Idle</h1>
<script>
// Stands in for @shipvo/device's web build: the same online rule as isOnline() in packages/device/src/index.web.ts.
const st = { online: true, networkProfile: "online", airplane: false, wifi: true, mobileData: true };
window.__pnDevice = { set: (p) => Object.assign(st, p) };
window.__pnNet = { profile: () => st.networkProfile, online: () => st.online && st.networkProfile !== "offline" && !st.airplane && (st.wifi || st.mobileData), log() {} };
</script>
<script>
window.pay = async () => {
  try { const r = await fetch(window.BACKEND + "/orders", { method: "POST", body: "{}" }); document.getElementById("h").textContent = "Placed " + r.status; }
  catch (e) { document.getElementById("h").textContent = "Failed " + e.name + " " + e.message; }
};
window.timed = async (kind) => {
  const t0 = performance.now();
  try {
    if (kind === "xhr") await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.onloadend = () => (x.status ? res() : rej(new Error("xhr " + x.readyState + " " + x.status))); x.open("GET", window.BACKEND + "/slow"); x.send(); });
    else await fetch(window.BACKEND + "/slow");
    document.getElementById("h").textContent = "Took " + Math.round(performance.now() - t0);
  } catch (e) { document.getElementById("h").textContent = "Failed " + e.message; }
};
</script><button onclick="pay()">Pay</button><button onclick="timed('fetch')">Fetch</button><button onclick="timed('xhr')">Xhr</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium");
  }
  backend = http.createServer((req, res) => { if (req.method === "POST") orders.push(req.url); if (req.url === "/slow") { res.writeHead(200, { "access-control-allow-origin": "*" }); return res.end("ok"); } res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); res.end("ok"); });
  await new Promise((r) => backend.listen(0, "127.0.0.1", r));
  backendUrl = `http://127.0.0.1:${backend.address().port}`;
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE.replace("</head>", `<script>window.BACKEND=${JSON.stringify(backendUrl)}</script></head>`));
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error("sim did not start");
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); backend?.close(); rmSync(root, { recursive: true, force: true });
});
async function pay(session) {
  const s = (await act(session, { action: "screen" })).screen;
  await act(session, { action: "tap", ref: /Pay[^\n]*\[ref=(\w+)\]/.exec(s)[1] });
  for (let i = 0; i < 40; i++) {
    const r = await act(session, { action: "screen" });
    const m = /(?:Placed|Failed)[^\n"]*/.exec(r.screen); if (m) return m[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("no result");
}
const cases = [
  ["set_device online:false", { action: "set_device", device: { online: false } }, { action: "set_device", device: { online: true } }],
  ["airplane mode", { action: "set_device", device: { airplane: true } }, { action: "set_device", device: { airplane: false } }],
  ["offline device profile", { action: "set_device", device: { networkProfile: "offline" } }, { action: "set_device", device: { networkProfile: "online" } }],
  ["offline network profile", { action: "set_network_profile", profile: "offline" }, { action: "set_network_profile", profile: "online" }],
];
for (const [name, off, on] of cases) {
  test(`${name}: the order is not sent; back on, it is`, async () => {
    const id = name.replace(/\W+/g, "-");
    assert.ok((await call("/session", { session: id })).ok);
    orders.length = 0;
    await act(id, off);
    assert.match(await pay(id), /Failed TypeError Network request failed/);
    assert.equal(orders.length, 0);
    await act(id, on);
    assert.match(await pay(id), /Placed 200/);
    assert.equal(orders.length, 1);
  });
}

async function timed(session, label) {
  const s = (await act(session, { action: "screen" })).screen;
  await act(session, { action: "tap", ref: new RegExp(label + "[^\\n]*\\[ref=(\\w+)\\]").exec(s)[1] });
  for (let i = 0; i < 80; i++) {
    const r = await act(session, { action: "screen" });
    const m = /(?:Took \d+|Failed [^\n"]*)/.exec(r.screen); if (m) return m[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("no result");
}
for (const kind of ["Fetch", "Xhr"]) {
  test(`3g adds its latency once to ${kind}, not twice`, async () => {
    const id = `lat-${kind}`;
    assert.ok((await call("/session", { session: id })).ok);
    await act(id, { action: "set_network_profile", profile: "3g" });
    const ms = Number(/Took (\d+)/.exec(await timed(id, kind))?.[1]);
    assert.ok(ms >= 280 && ms < 520, `3g latency is 300 ms, took ${ms} ms`);
  });
  test(`offline: ${kind} ends like a failed request, with status 0 and loadend`, async () => {
    const id = `off-${kind}`;
    assert.ok((await call("/session", { session: id })).ok);
    await act(id, { action: "set_device", device: { airplane: true } });
    const r = await timed(id, kind);
    assert.match(r, kind === "Xhr" ? /Failed xhr 4 0/ : /Failed Network request failed/);
  });
}
test("offline survives a cold start", async () => {
  const id = "off-cold";
  assert.ok((await call("/session", { session: id })).ok);
  orders.length = 0;
  await act(id, { action: "set_network_profile", profile: "offline" });
  await act(id, { action: "open_recents" });
  assert.equal((await act(id, { action: "kill_app" })).ok, true);
  await act(id, { action: "resume_app" });
  assert.match(await pay(id), /Failed TypeError Network request failed/);
  assert.equal(orders.length, 0);
});
