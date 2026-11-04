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
