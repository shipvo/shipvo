// The Browser app against a local test page and a real Chromium (no network).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser, hostAllowed, privateHost, UA_MARK } from "./phone-browser.mjs";

const require = createRequire(import.meta.url);
const pw = require("playwright");
const PAGES = {
  "/": `<!doctype html><meta name="viewport" content="width=device-width"><title>Home</title><h1>Welcome</h1><a href="/next">Go next</a><label>Name <input id="n"></label><button onclick="document.title='Clicked'">Press</button><p>cookie:<span id="c"></span></p><script>document.getElementById('c').textContent=document.cookie||'none'</script>`,
  "/next": `<!doctype html><title>Next</title><h1>Second page</h1>`,
  "/pop": `<!doctype html><title>Pop</title><a target="_blank" href="/next">Open new</a>`,
  "/set": `<!doctype html><title>Set</title><script>document.cookie='phone=1'</script>ok`,
};
let srv, base, base2, browser;
before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url.startsWith("/redir?")) { res.writeHead(302, { location: decodeURIComponent(req.url.slice(7)) }); return res.end(); }
    res.writeHead(PAGES[req.url] ? 200 : 404, { "content-type": "text/html" }); res.end(PAGES[req.url] ?? "no"); });
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
  const b = new PhoneBrowser({ browser, allowPrivate: true });
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
  const b = new PhoneBrowser({ browser, skin: "ios", allowPrivate: true });
  await b.open(base + "/");
  const p = b.page();
  assert.deepEqual(await p.evaluate(() => [innerWidth, innerHeight, devicePixelRatio, navigator.maxTouchPoints > 0]), [393, 852, 3, true]);
  assert.ok((await p.evaluate(() => navigator.userAgent)).endsWith(UA_MARK));
  await b.close();
});

test("allowlist blocks other hosts, for open and for navigation, and every navigation is logged", async () => {
  const b = new PhoneBrowser({ browser, allowPrivate: true, allowHosts: ["127.0.0.1"] });
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
  const a = new PhoneBrowser({ browser, allowPrivate: true }), c = new PhoneBrowser({ browser, allowPrivate: true });
  await a.open(base + "/set");
  assert.match((await a.open(base + "/")).snapshot, /phone=1/);
  assert.match((await c.open(base + "/")).snapshot, /cookie:\s*none|none/);
  await a.close(); await c.close();
  await assert.rejects(a.snapshot(), { code: "no_tab" });
});

test("privateHost: loopback, link-local, private ranges, .local and .internal; public hosts pass", () => {
  for (const u of ["http://127.0.0.1/", "http://localhost:3000/", "http://169.254.169.254/", "http://10.1.2.3/", "http://172.16.0.1/", "http://172.31.255.1/", "http://192.168.1.1/", "http://0.0.0.0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://2130706433/", "http://printer.local/", "http://db.internal/"]) assert.equal(privateHost(u), true, u);
  for (const u of ["https://example.com/", "http://8.8.8.8/", "http://172.32.0.1/", "http://192.169.0.1/"]) assert.equal(privateHost(u), false, u);
});

test("private hosts are refused by default; allow_private or listing the host opens them", async () => {
  const b = new PhoneBrowser({ browser });
  await assert.rejects(b.open(base + "/"), { code: "host_not_allowed" });
  await assert.rejects(b.open("http://169.254.169.254/latest/meta-data/"), { code: "host_not_allowed" });
  assert.deepEqual(await b.tabsList(), []);
  await b.close();
  const listed = new PhoneBrowser({ browser, allowHosts: ["127.0.0.1"] });
  assert.equal((await listed.open(base + "/")).title, "Home");
  await listed.close();
});

test("a redirect to a blocked host is refused and leaves no tab", async () => {
  const b = new PhoneBrowser({ browser, allowPrivate: true, allowHosts: ["127.0.0.1"] });
  await assert.rejects(b.open(`${base}/redir?${encodeURIComponent(base2 + "/next")}`), { code: "host_not_allowed" });
  assert.deepEqual(await b.tabsList(), []);
  await assert.rejects(b.snapshot(), { code: "no_tab" });
  await b.close();
  // Default: a public-looking start cannot redirect into the private network. The start itself is local here, so use allow_hosts to reach the redirector.
  const d = new PhoneBrowser({ browser, allowHosts: ["127.0.0.1"] });
  await assert.rejects(d.open(`${base}/redir?${encodeURIComponent("http://169.254.169.254/")}`), { code: "host_not_allowed" });
  assert.deepEqual(await d.tabsList(), []);
  await d.close();
});

test("a page opened by the site (target=_blank) becomes a tab and the active one", async () => {
  const b = new PhoneBrowser({ browser, allowPrivate: true });
  const snap = await b.open(base + "/pop");
  const ref = /link.*\[ref=(e\d+)\]/.exec(snap.snapshot)[1];
  await b.page().locator(`aria-ref=${ref}`).click();
  for (let i = 0; i < 50 && (await b.tabsList()).length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  const tabs = await b.tabsList();
  assert.equal(tabs.length, 2);
  assert.equal(tabs.filter((t) => t.active).length, 1);
  assert.deepEqual(tabs.map((t) => t.tab), ["t1", "t2"]);
  await b.close();
});

test("waitFor uses one deadline for text and url", async () => {
  const b = new PhoneBrowser({ browser, allowPrivate: true });
  await b.open(base + "/");
  const t0 = Date.now();
  await assert.rejects(b.waitFor({ url: "/never", text: "nope", timeoutMs: 600 }), { code: "timeout" });
  assert.ok(Date.now() - t0 < 1100);
  await b.close();
});
