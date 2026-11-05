// The Browser app against a local test page and a real Chromium (no network).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser, hostAllowed, UA_MARK } from "./phone-browser.mjs";

const require = createRequire(import.meta.url);
const pw = require("playwright");
const PAGES = {
  "/": `<!doctype html><meta name="viewport" content="width=device-width"><title>Home</title><h1>Welcome</h1><a href="/next">Go next</a><label>Name <input id="n"></label><button onclick="document.title='Clicked'">Press</button><p>cookie:<span id="c"></span></p><script>document.getElementById('c').textContent=document.cookie||'none'</script>`,
  "/next": `<!doctype html><title>Next</title><h1>Second page</h1>`,
  "/set": `<!doctype html><title>Set</title><script>document.cookie='phone=1'</script>ok`,
};
let srv, base, base2, browser;
before(async () => {
  srv = http.createServer((req, res) => { res.writeHead(PAGES[req.url] ? 200 : 404, { "content-type": "text/html" }); res.end(PAGES[req.url] ?? "no"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`; base2 = `http://localhost:${srv.address().port}`;
  browser = await pw.chromium.launch(resolveBrowser({ pw, log: () => {} }));
});
after(async () => { await browser?.close(); srv?.close(); });

test("hostAllowed: empty allows all, exact and wildcard match", () => {
  assert.equal(hostAllowed("https://a.com/x", []), true);
  assert.equal(hostAllowed("https://a.com/x", ["a.com"]), true);
  assert.equal(hostAllowed("https://b.com/x", ["a.com"]), false);
  assert.equal(hostAllowed("https://m.a.com/", ["*.a.com"]), true);
  assert.equal(hostAllowed("https://evila.com/", ["*.a.com"]), false);
});

test("opens a page and returns a tree with refs, marked untrusted; click and type change the page", async () => {
  const b = new PhoneBrowser({ browser });
  const snap = await b.open(base + "/");
  assert.equal(snap.source, "web"); assert.equal(snap.untrusted, true);
  assert.equal(snap.title, "Home"); assert.match(snap.url, /127\.0\.0\.1/);
  assert.match(snap.snapshot, /Welcome/); assert.match(snap.snapshot, /\[ref=e\d+\]/);
  const ref = (re) => new RegExp(re + ".*\\[ref=(e\\d+)\\]").exec(snap.snapshot)[1];
  const typed = await b.type(ref("textbox"), "Ada");
  assert.match(typed.snapshot, /Ada/);
  const clicked = await b.click(ref("button"), undefined);
  assert.equal(clicked.title, "Clicked");
  const nav = await b.click(ref("link"));
  assert.equal(nav.title, "Next");
  assert.equal((await b.back()).title, "Home");
  assert.deepEqual((await b.tabsList()).map((t) => t.active), [true]);
  assert.equal((await b.waitFor({ text: "Welcome" })).title, "Home");
  await assert.rejects(b.waitFor({ text: "nope", timeoutMs: 300 }), { code: "timeout" });
  await assert.rejects(b.click("e999"), { code: "stale_ref" });
  assert.ok((await b.screenshot()).length > 100);
  await b.close();
});

test("mobile emulation: skin size and a user agent marked ShipvoPhone", async () => {
  const b = new PhoneBrowser({ browser, skin: "ios" });
  await b.open(base + "/");
  const p = b.page();
  assert.deepEqual(await p.evaluate(() => [innerWidth, innerHeight, devicePixelRatio, navigator.maxTouchPoints > 0]), [393, 852, 3, true]);
  assert.ok((await p.evaluate(() => navigator.userAgent)).endsWith(UA_MARK));
  await b.close();
});

test("allowlist blocks other hosts, for open and for navigation, and every navigation is logged", async () => {
  const b = new PhoneBrowser({ browser, allowHosts: ["127.0.0.1"] });
  await b.open(base + "/");
  await assert.rejects(b.open(base2 + "/"), { code: "host_not_allowed" });
  await assert.rejects(b.open("file:///etc/passwd"), { code: "bad_url" });
  await assert.rejects(b.page().goto(base2 + "/next"));
  const log = b.navLog;
  assert.ok(log.some((e) => e.ok && e.url.startsWith(base)));
  assert.ok(log.filter((e) => e.code === "host_not_allowed").length >= 2);
  await b.close();
});

test("each phone has its own isolated context (cookies)", async () => {
  const a = new PhoneBrowser({ browser }), c = new PhoneBrowser({ browser });
  await a.open(base + "/set");
  assert.match((await a.open(base + "/")).snapshot, /phone=1/);
  assert.match((await c.open(base + "/")).snapshot, /cookie:\s*none|none/);
  await a.close(); await c.close();
  await assert.rejects(a.snapshot(), { code: "no_tab" });
});
