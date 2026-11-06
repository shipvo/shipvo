import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seen = [];
const png = join(tmpdir(), "bench-shot.png"); writeFileSync(png, "x");
const srv = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = JSON.parse(b); seen.push(body);
    res.end(JSON.stringify({ ok: true, path: png, screen: "- button \"Secret label\" [ref=e1]" }));
  });
}).listen(0);
await new Promise((r) => srv.on("listening", r));
process.env.PN_SIM = `http://127.0.0.1:${srv.address().port}`; process.env.BENCH_SESSION = "s1";
const { callTool, TOOLS } = await import("./baseline-mcp.mjs");

test("baseline offers screenshot and coordinates only, and never leaks the labelled screen", async () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["screenshot", "tap", "type_text", "swipe"]);
  const shot = await callTool("screenshot");
  assert.equal(shot.content[0].type, "image");
  const tap = await callTool("tap", { x: 10, y: 20 });
  assert.equal(JSON.stringify(tap).includes("Secret"), false);
  assert.deepEqual(seen.at(-1), { session: "s1", action: "tap_xy", x: 10, y: 20 });
  await callTool("type_text", { text: "hi", enter: true });
  assert.deepEqual(seen.at(-1), { session: "s1", action: "type_keys", text: "hi", enter: true });
  assert.equal((await callTool("nope")).isError, true);
  srv.close();
});
