import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createSecretsForward, isVaultUiPath } from "./secrets-forward.mjs";

const TOKEN = "owner-token-abc123";
async function setup() {
  const calls = [];
  const fetchImpl = async (u, init) => { calls.push({ u, method: init.method, auth: init.headers.authorization }); return new Response(JSON.stringify({ ok: true, echo: `Bearer ${TOKEN}` }), { status: 200, headers: { "content-type": "application/json" } }); };
  const handle = createSecretsForward({ control: "https://cp.test", token: TOKEN, fetchImpl });
  const srv = http.createServer((req, res) => { const url = new URL(req.url, "http://x"); if (isVaultUiPath(url.pathname)) return handle(req, res, url); res.writeHead(200); res.end("other"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const call = (method, path, headers = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on("error", reject); r.end();
  });
  return { calls, call, port, close: () => srv.close() };
}

test("the four routes are forwarded with the right method and path", async () => {
  const s = await setup();
  const want = [
    ["GET", "/vault-ui/keys?app=shop", "https://cp.test/vault/keys?app=shop"],
    ["POST", "/vault-ui/keys/shop/stripe/rotate", "https://cp.test/vault/keys/shop/stripe/rotate"],
    ["DELETE", "/vault-ui/keys/shop/stripe", "https://cp.test/vault/keys/shop/stripe"],
    ["GET", "/vault-ui/keys/shop/stripe/uses", "https://cp.test/vault/keys/shop/stripe/uses"],
  ];
  for (const [m, p, u] of want) assert.equal((await s.call(m, p)).status, 200);
  assert.deepEqual(s.calls.map((c) => [c.method, c.u]), want.map((w) => [w[0], w[2]]));
  assert.ok(s.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  s.close();
});

test("other paths, wrong methods, bad hosts and cross-origin calls never reach upstream", async () => {
  const s = await setup();
  assert.equal((await s.call("GET", "/vault-ui/status/shop/x")).status, 404);
  assert.equal((await s.call("GET", "/vault-ui/keys/shop/stripe/../../x")).status, 404);
  assert.equal((await s.call("GET", "/vault-ui/keys/shop/stripe/rotate")).status, 405);
  assert.equal((await s.call("PUT", "/vault-ui/keys?app=shop")).status, 405);
  assert.equal((await s.call("POST", "/vault-ui/keys?app=shop")).status, 405);
  assert.equal((await s.call("GET", "/vault-ui/keys")).status, 400);
  assert.equal((await s.call("GET", "/vault-ui/keys?app=shop", { host: "evil.example" })).status, 403);
  assert.equal((await s.call("GET", "/vault-ui/keys?app=shop", { host: "localhost.evil.example" })).status, 403);
  assert.equal((await s.call("GET", "/vault-ui/keys?app=shop", { origin: "https://evil.example" })).status, 403);
  assert.equal((await s.call("GET", "/vault-ui/keys?app=shop", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(s.calls.length, 0);
  assert.equal((await s.call("GET", "/vault-ui/keys?app=shop", { origin: `http://127.0.0.1:${s.port}`, "sec-fetch-site": "same-origin" })).status, 200);
  assert.equal(s.calls.length, 1);
  s.close();
});

test("no response or header contains the owner token", async () => {
  const s = await setup();
  for (const [m, p, h] of [["GET", "/vault-ui/keys?app=shop"], ["GET", "/vault-ui/nope"], ["GET", "/vault-ui/keys?app=shop", { host: "evil.example" }]]) {
    const r = await s.call(m, p, h);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  }
  const r = await s.call("GET", "/vault-ui/keys?app=shop");
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.equal(r.headers["access-control-allow-origin"], undefined);
  s.close();
});
