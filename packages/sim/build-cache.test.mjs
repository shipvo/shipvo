import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchBuild } from "./build-cache.mjs";

const body = Buffer.from("fixture build bytes");
let srv, base, dir;
before(async () => {
  srv = createServer((req, res) => {
    if (req.url === "/app.zip") return res.end(body);
    if (req.url === "/big") return res.end(Buffer.alloc(5000, 1));
    if (req.url === "/hop") { res.writeHead(302, { location: "http://10.0.0.5/x" }); return res.end(); }
    if (req.url === "/slow") return;   // never answers
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.closeAllConnections(); srv.close(); });
const fresh = async () => { dir = await mkdtemp(join(tmpdir(), "bc-")); return dir; };
const local = { allowHosts: ["127.0.0.1"] };
const code = (p) => p.then(() => "none", (e) => e.code);

test("fetches a fixture URL and stores it by content id", async () => {
  const d = await fresh();
  const r = await fetchBuild(`${base}/app.zip`, { dir: d, ...local });
  assert.equal(r.id, createHash("sha256").update(body).digest("hex"));
  assert.equal(r.bytes, body.length);
  assert.deepEqual(await readFile(r.path), body);
  const again = await fetchBuild(`${base}/app.zip`, { dir: d, ...local });
  assert.equal(again.id, r.id);
  assert.equal(again.cached, true);
  assert.deepEqual(await readdir(d), [r.id]);
  await rm(d, { recursive: true });
});

test("an oversize build is too_large and leaves no file", async () => {
  const d = await fresh();
  assert.equal(await code(fetchBuild(`${base}/big`, { dir: d, maxBytes: 1000, ...local })), "too_large");
  assert.deepEqual(await readdir(d), []);
});

test("an unreachable or failing host is unreachable and leaves no file", async () => {
  const d = await fresh();
  assert.equal(await code(fetchBuild(`${base}/missing`, { dir: d, ...local })), "unreachable");
  assert.equal(await code(fetchBuild(`${base}/slow`, { dir: d, timeoutMs: 100, ...local })), "unreachable");
  assert.equal(await code(fetchBuild("http://127.0.0.1:1/x", { dir: d, ...local })), "unreachable");
  assert.deepEqual(await readdir(d), []);
});

test("a private host is host_not_allowed, also after a redirect", async () => {
  const d = await fresh();
  assert.equal(await code(fetchBuild(`${base}/app.zip`, { dir: d })), "host_not_allowed");
  assert.equal(await code(fetchBuild(`${base}/hop`, { dir: d, ...local })), "host_not_allowed");
  assert.deepEqual(await readdir(d), []);
});

test("a bad URL is bad_url", async () => {
  const d = await fresh();
  assert.equal(await code(fetchBuild("not a url", { dir: d })), "bad_url");
  assert.equal(await code(fetchBuild("ftp://example.com/a", { dir: d })), "bad_url");
  assert.equal(await code(fetchBuild("data:text/plain,hi", { dir: d })), "bad_url");
  assert.deepEqual(await readdir(d), []);
});
