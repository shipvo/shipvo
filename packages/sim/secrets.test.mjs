import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { vaultUi, secretsRoute, describeSecrets, secretsRowHtml, useLogHtml, secretsClientScript } from "./secrets.mjs";
import { renderFrame, statusClientScript } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const KEYS = [{ app: "tide", name: "STRIPE_KEY", domain: "api.stripe.com", access: "read", last_used_at: "2026-11-01T10:30:00Z" }];

test("only the four metadata routes are forwarded", () => {
  assert.equal(secretsRoute("GET", "secrets/tide"), "/vault/secrets/tide");
  assert.equal(secretsRoute("DELETE", "secrets/tide/STRIPE_KEY"), "/vault/secrets/tide/STRIPE_KEY");
  assert.equal(secretsRoute("POST", "secrets/tide/STRIPE_KEY/rotate"), "/vault/secrets/tide/STRIPE_KEY/rotate");
  assert.equal(secretsRoute("GET", "secrets/tide/STRIPE_KEY/uses"), "/vault/secrets/tide/STRIPE_KEY/uses");
  for (const [m, p] of [["POST", "secrets/tide"], ["GET", "secrets/tide/K"], ["POST", "tickets"], ["GET", "t/vt_x"], ["GET", "secrets/../tickets"], ["PUT", "secrets/tide/K/uses"]]) assert.equal(secretsRoute(m, p), null, `${m} ${p}`);
});

test("rows show app, name, domain, access and last used", () => {
  assert.match(describeSecrets(KEYS), /tide \/ STRIPE_KEY: api\.stripe\.com, read access, last used 2026-11-01 10:30/);
  assert.match(secretsRowHtml(KEYS[0]), /Rotate.*Revoke.*Use log/);
  assert.match(describeSecrets([]), /No saved keys/);
  assert.match(useLogHtml([{ at: "2026-11-01T10:30:00Z", app: "tide", host: "api.stripe.com", outcome: "used" }]), /api\.stripe\.com · used/);
  assert.match(secretsRowHtml({ ...KEYS[0], name: '"><img>' }), /&quot;&gt;&lt;img&gt;/);
});


const HDR = { host: "localhost:7000" };
test("foreign origins get 403 and never reach the control plane; preflights are refused", async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return { status: 200, json: async () => ({}) }; };
  const run = (method, rest, headers) => vaultUi({ method, rest, headers: { ...HDR, ...headers }, token: "t", control: "https://cp.test", fetchImpl, app: () => "tide" });
  for (const [m, p] of [["GET", "secrets/tide"], ["DELETE", "secrets/tide/K"], ["POST", "secrets/tide/K/rotate"], ["OPTIONS", "secrets/tide/K"], ["GET", "app"]]) {
    const r = await run(m, p, { origin: "https://evil.example" }); assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal((await run("GET", "secrets/tide", { origin: "http://localhost:7001" })).status, 403);
  assert.equal((await run("GET", "secrets/tide", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await run("DELETE", "secrets/tide/K", { origin: "http://localhost:7000" })).status, 200);
  assert.equal(calls, 1);
  assert.deepEqual((await run("GET", "app", {})).body, { app: "tide" });
  assert.equal((await vaultUi({ method: "GET", rest: "secrets/tide", headers: HDR, token: "", control: "x", fetchImpl, app: () => "tide" })).status, 401);
});

test("a rebound hostname with a matching Origin gets 403 and no fetch", async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return { status: 200, json: async () => ({}) }; };
  const run = (host, origin) => vaultUi({ method: "GET", rest: "secrets/tide", headers: { host, ...(origin ? { origin } : {}) }, token: "t", control: "https://cp.test", fetchImpl, app: () => "tide" });
  assert.equal((await run("attacker.example:7000", "http://attacker.example:7000")).status, 403);
  assert.equal((await run("attacker.example:7000")).status, 403);
  assert.equal(calls, 0);
  for (const h of ["localhost:7000", "127.0.0.1:7000", "[::1]:7000"]) assert.equal((await run(h, `http://${h}`)).status, 200, h);
});

async function setup(b, page, skin, state) {
  const p = await b.newPage({ viewport: { width: 460, height: 960 } });
  const calls = [];
  await p.route("http://phone.test/vault-ui/**", (r) => {
    const u = new URL(r.request().url()), m = r.request().method(); calls.push(`${m} ${u.pathname}`);
    const json = (o, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
    if (u.pathname === "/vault-ui/app") return json({ app: "tide" });
    if (state.fail) return json({ error: "unauthorized", message: "Set PN_OWNER_TOKEN to manage saved keys." }, 401);
    if (m === "DELETE") { state.keys = []; return json({ revoked: true }); }
    if (u.pathname.endsWith("/rotate")) return json({ url: "https://cp.test/vault/t/vt_x", ticket: "vt_x" });
    if (u.pathname.endsWith("/uses")) return json({ uses: [{ at: "2026-11-01T10:30:00Z", app: "tide", host: "api.stripe.com", outcome: "used" }] });
    return json({ secrets: state.keys });
  });
  await p.route("http://phone.test/page", (r) => r.fulfill({ contentType: "text/html", body: page }));
  await p.goto("http://phone.test/page");
  await p.addScriptTag({ content: statusClientScript("app", skin) });
  await p.evaluate(() => { document.querySelector('[data-part="settings-screen"]').hidden = false; });
  return { p, calls };
}

const pageFor = (skin) => { const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="<p>app</p>"></iframe>` }); return `<!doctype html><style>${f.css}</style>${f.html}`; };
for (const [name, make] of [["frame page", pageFor]]) {
  test(`Secrets in the ${name} with no data-app attribute: list, rotate, confirm and revoke, close and reopen, errors, both skins`, async () => {
    const b = await chromium.launch();
    try {
      for (const skin of ["android", "ios"]) {
        const state = { keys: [...KEYS] };
        const { p, calls } = await setup(b, make(skin), skin, state);
        await p.click('[data-part="secrets-open"]');
        await p.waitForSelector("[data-secret]");
        const text = await p.innerText('[data-part="secrets"]');
        assert.match(text, /Secrets for tide/); assert.match(text, /STRIPE_KEY/); assert.match(text, /api\.stripe\.com/);
        await p.click('[data-secret-act="uses"]'); await p.waitForSelector(".sf-uses");
        await p.click('[data-secret-act="rotate"]'); await p.waitForSelector(".sf-slink a");
        assert.equal(await p.getAttribute(".sf-slink a", "href"), "https://cp.test/vault/t/vt_x");
        assert.match(await p.innerText(".sf-slink"), /old key keeps working until you save the new one/);
        // revoke asks first
        await p.click('[data-secret-act="revoke"]');
        assert.match(await p.innerText(".sf-confirm"), /Revoke STRIPE_KEY\? Apps will ask for a new one\./);
        assert.equal(await p.evaluate(() => document.activeElement.getAttribute("data-confirm")), "no");
        assert.ok(!calls.some((c) => c.startsWith("DELETE")), "no DELETE before confirming");
        await p.keyboard.press("Escape");
        assert.equal(await p.locator(".sf-confirm").count(), 0);
        assert.equal(await p.locator('[data-part="secrets"]').isVisible(), true, "Escape closes only the prompt");
        await p.click('[data-secret-act="revoke"]'); await p.click('[data-confirm="yes"]');
        await p.waitForFunction(() => !document.querySelector("[data-secret]"));
        assert.ok(calls.some((c) => c.startsWith("DELETE")), skin);
        // close Settings while Secrets is open, then reopen
        await p.click('[data-part="settings-close"]');
        await p.evaluate(() => { document.querySelector('[data-part="settings-screen"]').hidden = false; });
        assert.equal(await p.locator('[data-part="secrets"]').isVisible(), false);
        assert.equal(await p.evaluate(() => document.querySelector('[data-part="settings-rows"]').hidden), false);
        await p.close();
      }
    } finally { await b.close(); }
  });
}

test("a 401 shows the server message, not 'No saved keys.'", async () => {
  const b = await chromium.launch();
  try {
    const { p } = await setup(b, pageFor("android"), "android", { keys: KEYS, fail: true });
    await p.click('[data-part="secrets-open"]');
    await p.waitForSelector(".sf-err");
    const t = await p.innerText('[data-part="secrets"]');
    assert.match(t, /Set PN_OWNER_TOKEN to manage saved keys\./); assert.doesNotMatch(t, /No saved keys/);
  } finally { await b.close(); }
});
