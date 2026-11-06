import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser, isPrivateHost, checkUrl } from "./phone-browser.mjs";

const pw = createRequire(import.meta.url)("playwright");
let browser, server, base;
const PAGE = `<!doctype html><title>Shop</title><h1 id=h>Welcome</h1><a href="/next">Next page</a>
<label>Name <input aria-label="Name"></label><button onclick="document.getElementById('h').textContent='Hi '+document.querySelector('input').value">Greet</button>
<p id=ua></p><script>document.getElementById('ua').textContent = navigator.userAgent + ' touch=' + navigator.maxTouchPoints</script>`;
before(async () => {
  browser = await pw.chromium.launch(resolveBrowser({ pw }));
  server = http.createServer((req, res) => {
    if (req.url === "/set") { res.writeHead(200, { "set-cookie": "sid=abc; Path=/", "content-type": "text/html" }); return res.end("set"); }
    if (req.url === "/cookie") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<body>cookie:[${req.headers.cookie ?? ""}]`); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(req.url === "/next" ? "<h1>Second</h1>" : PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await browser?.close(); server?.close(); });

test("open, snapshot with refs, click and type change the page", async () => {
  const pb = new PhoneBrowser(browser, { allowPrivate: true });
  try {
    const s = await pb.open(base + "/");
    assert.equal(s.source, "web"); assert.equal(s.untrusted, true);
    assert.match(s.tree, /Welcome/); assert.match(s.tree, /\[ref=(?:f\d+)?e\d+\]/);
    assert.match(s.tree, /ShipvoPhone|Welcome/);
    const ua = await pb.page.evaluate(() => navigator.userAgent + " " + navigator.maxTouchPoints);
    assert.match(ua, /ShipvoPhone/); assert.match(ua, / [1-9]/);
    const field = /textbox "Name" \[ref=((?:f\d+)?e\d+)\]/.exec(s.tree)?.[1]; assert.ok(field, s.tree);
    const t = await pb.type(field, "Ada");
    const btn = /button "Greet" \[ref=((?:f\d+)?e\d+)\]/.exec(t.tree)[1];
    assert.match((await pb.click(btn)).tree, /Hi Ada/);
    const again = (await pb.open(base + "/")).tree; const link = /link "Next page" \[ref=((?:f\d+)?e\d+)\]/.exec(again)?.[1]; assert.ok(link, again);
    assert.match((await pb.click(link)).tree, /Second/);
    assert.match((await pb.back()).tree, /Welcome/);
    await assert.rejects(pb.click("e999"), { code: "stale_ref" });
    assert.ok((await pb.screenshot()).length > 100);
    assert.ok(pb.navigations.some((n) => n.detail.url.endsWith("/next") && n.detail.allowed));
  } finally { await pb.close(); }
});

test("private hosts are refused and the opt-in allows them", async () => {
  for (const h of ["localhost", "127.0.0.1", "[::1]", "169.254.169.254", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "printer.local", "db.internal", "[::ffff:7f00:1]", "[fd00::1]"])
    assert.equal(isPrivateHost(h.replace(/^\[|\]$/g, "")), true, h);
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1"]) assert.equal(isPrivateHost(h), false, h);
  const pb = new PhoneBrowser(browser, {});
  await assert.rejects(pb.open(base + "/"), { code: "host_not_allowed" });
  assert.equal(pb.page, null);
  assert.equal(pb.navigations.at(-1).detail.allowed, false);
  await assert.rejects(checkUrl("http://public.test/", {}, async () => [{ address: "10.0.0.5" }]), { code: "host_not_allowed" });
  await assert.rejects(checkUrl("file:///etc/passwd"), { code: "bad_url" });
  const byHost = new PhoneBrowser(browser, { allowHosts: ["127.0.0.1"] });
  const other = new PhoneBrowser(browser, { allowHosts: ["example.org"] });
  try {
    assert.match((await byHost.open(base + "/")).tree, /Welcome/);
    await assert.rejects(other.open(base + "/"), { code: "host_not_allowed" });
  } finally { await byHost.close(); await other.close(); }
});

test("two phones do not share cookies", async () => {
  const a = new PhoneBrowser(browser, { allowPrivate: true }), b = new PhoneBrowser(browser, { allowPrivate: true });
  try {
    await a.open(base + "/set");
    assert.match((await a.open(base + "/cookie")).tree, /sid=abc/);
    assert.doesNotMatch((await b.open(base + "/cookie")).tree, /sid=abc/);
  } finally { await a.close(); await b.close(); }
});
