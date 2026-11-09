import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { vaultRoute, forwardVault, loopbackHost, sameOrigin } from "./secrets.mjs";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const shots = process.env.SETTINGS_SHOTS;
const VALUE = "sk_live_TOPSECRETVALUE";
const H = { host: "localhost:4000" };

// A fake control plane that, like the real one, never returns a value. It leaks one anyway so we can check the scrub.
function fakePlane() {
  const keys = [{ app: "tide", name: "stripe", domain: "api.stripe.com", access: "read", last_used_at: "2026-11-09T10:00:00Z", value: VALUE }, { app: "tide", name: "maps", domain: "maps.example.com", access: "read", last_used_at: null }];
  const seen = [];
  const f = async (url, init) => {
    const u = new URL(url); seen.push({ method: init.method, path: u.pathname + u.search, auth: init.headers.authorization });
    const j = (s, b) => ({ status: s, ok: s < 300, text: async () => JSON.stringify(b) });
    const m = u.pathname.match(/^\/vault\/keys(?:\/(\w+)\/(\w+)(?:\/(rotate|uses))?)?$/);
    if (!m) return j(404, {});
    if (!m[1]) return j(200, { keys });
    if (m[3] === "rotate") return j(201, { ticket: "t1", url: "https://api.example.test/vault/t/t1", expires_in: 600 });
    if (m[3] === "uses") return j(200, { uses: [{ at: "2026-11-09T10:00:00Z", app: "tide", host: "api.stripe.com", outcome: "ok" }] });
    keys.splice(keys.findIndex((k) => k.name === m[2]), 1); return j(200, { revoked: true });
  };
  return { f, seen };
}

test("only the four routes map; others are null", () => {
  assert.equal(vaultRoute("GET", "/vault-ui/keys", "?app=tide").path, "/vault/keys?app=tide");
  assert.equal(vaultRoute("POST", "/vault-ui/keys/tide/stripe/rotate").path, "/vault/keys/tide/stripe/rotate");
  assert.equal(vaultRoute("DELETE", "/vault-ui/keys/tide/stripe").path, "/vault/keys/tide/stripe");
  assert.equal(vaultRoute("GET", "/vault-ui/keys/tide/stripe/uses").path, "/vault/keys/tide/stripe/uses");
  for (const [m, p] of [["POST", "/vault-ui/tickets"], ["GET", "/vault-ui/status/tide/stripe"], ["GET", "/vault-ui/t/abc"], ["GET", "/vault-ui/keys/tide/stripe"], ["POST", "/vault-ui/keys/tide/stripe"], ["GET", "/vault-ui/keys/../x/y/uses"], ["GET", "/vault-ui/keys/a/b/c/d"], ["GET", "/vault/keys"]]) assert.equal(vaultRoute(m, p, "?app=tide"), null, `${m} ${p}`);
});

test("the forward rejects other routes, non-loopback Host and cross-origin calls", async () => {
  const { f, seen } = fakePlane(); const o = { control: "https://cp.test", token: "OWNER", fetchImpl: f };
  const req = (over) => ({ method: "GET", pathname: "/vault-ui/keys", search: "?app=tide", headers: H, ...over });
  assert.equal((await forwardVault(req({ pathname: "/vault-ui/tickets", method: "POST" }), o)).status, 404);
  assert.equal((await forwardVault(req({ headers: { host: "evil.example" } }), o)).status, 403);
  assert.equal((await forwardVault(req({ headers: { host: "localhost.evil.com" } }), o)).status, 403);
  assert.equal((await forwardVault(req({ headers: { ...H, origin: "https://evil.example" } }), o)).status, 403);
  assert.equal((await forwardVault(req({ headers: { ...H, "sec-fetch-site": "cross-site" } }), o)).status, 403);
  assert.equal(seen.length, 0);
  assert.equal(loopbackHost("127.0.0.1:9"), true); assert.equal(sameOrigin({ host: "localhost:4000", origin: "http://localhost:4000" }), true);
  const ok = await forwardVault(req({ headers: { ...H, origin: "http://localhost:4000" } }), o);
  assert.equal(ok.status, 200); assert.equal(seen[0].auth, "Bearer OWNER");
  assert.equal(JSON.stringify(ok.body).includes(VALUE), false, "no value in the response");
  assert.equal((await forwardVault(req(), { ...o, token: "" })).status, 503);
});

test("the sim server answers /vault-ui/* and never returns the owner token", async () => {
  const { f } = fakePlane();
  const srv = http.createServer(async (rq, rs) => { const u = new URL(rq.url, "http://x"); const r = await forwardVault({ method: rq.method, pathname: u.pathname, search: u.search, headers: rq.headers }, { control: "https://cp.test", token: "OWNER", fetchImpl: f }); rs.writeHead(r.status); rs.end(JSON.stringify(r.body)); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const port = srv.address().port;
    const good = await fetch(`http://127.0.0.1:${port}/vault-ui/keys?app=tide`); const txt = await good.text();
    assert.equal(good.status, 200); assert.equal(txt.includes("OWNER") || txt.includes(VALUE), false);
    const bad = await new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: "/vault-ui/keys?app=tide", headers: { host: "evil.example" } }, (m) => { m.resume(); res(m.statusCode); }).on("error", rej)); assert.equal(bad, 403);
  } finally { srv.close(); }
});

test("the screen lists metadata only, rotates to a ticket link and revokes a row (Android and iPhone)", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
  const { f } = fakePlane();
  const srv = http.createServer(async (rq, rs) => { const u = new URL(rq.url, "http://x"); const r = await forwardVault({ method: rq.method, pathname: u.pathname, search: u.search, headers: rq.headers }, { control: "https://cp.test", token: "OWNER", fetchImpl: f }); rs.writeHead(r.status, { "content-type": "application/json" }); rs.end(JSON.stringify(r.body)); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
      const fr = renderFrame({ skin, screen: `<div id="app"></div>` });
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      await p.route(`http://localhost:${srv.address().port}/?app=tide`, (r) => r.fulfill({ contentType: "text/html", body: `<style>${fr.css}</style>${fr.html}<script>${statusClientScript("app", skin)}</script>` }));
      await p.goto(`http://localhost:${srv.address().port}/?app=tide`);
      await p.evaluate(() => { const s = document.querySelector('[data-part="settings-screen"]'); s.hidden = false; });
      await p.click('[data-part="secrets-open"]');
      await p.waitForSelector(".sf-key");
      assert.equal(await p.locator(".sf-key").count(), 2);
      assert.equal((await p.content()).includes(VALUE), false, "no value in the DOM");
      assert.match(await p.locator(".sf-key").first().innerText(), /stripe[\s\S]*api\.stripe\.com[\s\S]*read[\s\S]*last used/);
      await p.locator(".sf-key").first().getByRole("button", { name: "Use log" }).click();
      await p.waitForSelector(".sf-uses li"); assert.match(await p.locator(".sf-uses li").innerText(), /api\.stripe\.com/);
      await p.locator(".sf-key").first().getByRole("button", { name: "Rotate" }).click();
      await p.waitForSelector(".sf-key a"); assert.match(await p.locator(".sf-key a").innerText(), /\/vault\/t\/t1$/);
      if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${skin}-secrets.png`, clip: await p.locator('[data-part="phone-body"]').boundingBox() }); }
      await p.locator(".sf-key").first().getByRole("button", { name: "Revoke" }).click();
      await p.waitForFunction(() => document.querySelectorAll(".sf-key").length === 1);
      assert.equal((await p.content()).includes(VALUE), false);
      await p.close();
  } finally { srv.close(); }
    }
  } finally { await b.close(); }
});
