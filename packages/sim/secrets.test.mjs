import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { secretsRoute, describeSecrets, secretsRowHtml, useLogHtml, secretsClientScript } from "./secrets.mjs";
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

test("Settings, Secrets lists, rotates and revokes in both skins, and draws no value", async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ["android", "ios"]) {
      const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="<p>app</p>"></iframe>` });
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      const calls = []; let keys = [...KEYS];
      await p.route("http://phone.test/vault-ui/**", (r) => {
        const u = new URL(r.request().url()), m = r.request().method(); calls.push(`${m} ${u.pathname}`);
        const json = (o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
        if (m === "DELETE") { keys = []; return json({ revoked: true }); }
        if (u.pathname.endsWith("/rotate")) return json({ url: "https://cp.test/vault/t/vt_x", ticket: "vt_x" });
        if (u.pathname.endsWith("/uses")) return json({ uses: [{ at: "2026-11-01T10:30:00Z", app: "tide", host: "api.stripe.com", outcome: "used" }] });
        return json({ secrets: keys });
      });
      await p.route("http://phone.test/", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body data-app="tide"><style>${f.css}</style>${f.html}</body>` }));
      await p.goto("http://phone.test/");
      await p.addScriptTag({ content: `${statusClientScript("app", skin)}` });
      await p.evaluate(() => { document.querySelector('[data-part="settings-screen"]').hidden = false; });
      await p.click('[data-part="secrets-open"]');
      await p.waitForSelector("[data-secret]");
      const text = await p.innerText('[data-part="secrets"]');
      assert.match(text, /STRIPE_KEY/); assert.match(text, /api\.stripe\.com/);
      await p.click('[data-secret-act="uses"]'); await p.waitForSelector(".sf-uses");
      await p.click('[data-secret-act="rotate"]'); await p.waitForSelector(".sf-slink a");
      assert.equal(await p.getAttribute(".sf-slink a", "href"), "https://cp.test/vault/t/vt_x");
      await p.click('[data-secret-act="revoke"]'); await p.waitForFunction(() => !document.querySelector("[data-secret]"));
      assert.deepEqual(calls.map((c) => c.split(" ")[0]), ["GET", "GET", "POST", "DELETE", "GET"], skin);
      await p.close();
    }
  } finally { await b.close(); }
});
