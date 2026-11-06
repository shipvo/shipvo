import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.mjs";
import { parseLog, telemetry } from "./lib.mjs";

test("serves files, 404s unknown paths and traversal, and logs telemetry posts", async () => {
  const root = mkdtempSync(join(tmpdir(), "srv-")), log = join(root, "log"); mkdirSync(join(root, "tree/p"), { recursive: true });
  writeFileSync(join(root, "tree/p/b2.json"), '{"a":1}'); writeFileSync(join(root, "secret.txt"), "no"); writeFileSync(log, "");
  const s = await startServer(join(root, "tree"), 0, log), base = `http://127.0.0.1:${s.address().port}`;
  assert.equal(await (await fetch(base + "/p/b2.json")).text(), '{"a":1}');
  assert.equal((await fetch(base + "/p/b2")).status, 200); // .json is optional, like the control plane
  assert.equal((await fetch(base + "/nope")).status, 404);
  assert.equal((await fetch(base + "/..%2Fsecret.txt")).status, 404);
  await fetch(base + "/t", { method: "POST", body: JSON.stringify({ event: "applied", release: 3 }) });
  s.close();
  const e = parseLog(readFileSync(log, "utf8"));
  assert.equal(telemetry(e)[0].release, 3); assert.equal(e.find((x) => x.path === "/nope").status, 404);
});

test("cutFirst drops the first response part way, then serves Range with a 206; without it the file is served whole", async () => {
  const root = mkdtempSync(join(tmpdir(), "srv-")), log = join(root, "log"); mkdirSync(join(root, "tree/b"), { recursive: true });
  const data = Buffer.alloc(1000, 7); writeFileSync(join(root, "tree/b/r1.hbc"), data); writeFileSync(log, "");
  const cut = { path: "/b/r1.hbc", fraction: 0.5, done: false };
  const s = await startServer(join(root, "tree"), 0, log, { cutFirst: cut }), base = `http://127.0.0.1:${s.address().port}`;
  await assert.rejects(async () => (await fetch(base + "/b/r1.hbc")).arrayBuffer());
  const r = await fetch(base + "/b/r1.hbc", { headers: { range: "bytes=500-" } });
  assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), "bytes 500-999/1000"); assert.equal((await r.arrayBuffer()).byteLength, 500);
  assert.equal((await (await fetch(base + "/b/r1.hbc")).arrayBuffer()).byteLength, 1000); // only the first request is cut
  await new Promise((ok) => setTimeout(ok, 50)); s.closeAllConnections(); s.close();
  const e = parseLog(readFileSync(log, "utf8")).filter((x) => x.path === "/b/r1.hbc");
  assert.deepEqual(e.map((x) => [x.status, x.bytes, x.cut, x.range]), [[200, 500, true, undefined], [206, 500, undefined, "bytes=500-"], [200, 1000, undefined, undefined]]);
});
test("without cutFirst a Range header is ignored and nothing is cut", async () => {
  const root = mkdtempSync(join(tmpdir(), "srv-")), log = join(root, "log"); mkdirSync(join(root, "tree/b"), { recursive: true });
  writeFileSync(join(root, "tree/b/r1.hbc"), Buffer.alloc(100)); writeFileSync(log, "");
  const s = await startServer(join(root, "tree"), 0, log), base = `http://127.0.0.1:${s.address().port}`;
  const r = await fetch(base + "/b/r1.hbc", { headers: { range: "bytes=50-" } });
  assert.equal(r.status, 200); assert.equal((await r.arrayBuffer()).byteLength, 100); s.closeAllConnections(); s.close();
});
