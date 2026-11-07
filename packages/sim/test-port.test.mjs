import test from "node:test";
import assert from "node:assert/strict";
import { pickPort, isFetchBlockedPort } from "./test-port.mjs";

test("fetch really refuses port 5060", async () => {
  await assert.rejects(fetch("http://localhost:5060/"), (e) => /bad port/.test(e.cause?.message ?? e.message));
  assert.ok(isFetchBlockedPort(5060));
});

test("pickPort never returns a port fetch refuses", () => {
  // 5060 - 4900 = 160 and 5061 - 4900 = 161 of a 300-wide range
  const draws = [160 / 300, 161 / 300, 0.5];
  const port = pickPort(4900, 300, () => draws.shift());
  assert.equal(port, 4900 + 150);
});

test("fetch really refuses port 6566, which sizes.test.mjs could draw", async () => {
  await assert.rejects(fetch("http://localhost:6566/"), (e) => /bad port/.test(e.cause?.message ?? e.message));
  assert.ok(isFetchBlockedPort(6566));
});

test("every blocked port in the 6500-6799 test range is refused by fetch", async () => {
  for (let p = 6500; p < 6800; p++) {
    if (!isFetchBlockedPort(p)) continue;
    await assert.rejects(fetch(`http://localhost:${p}/`), (e) => /bad port/.test(e.cause?.message ?? e.message), String(p));
  }
});

test("no two test files draw ports from overlapping ranges", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const ranges = [];
  for (const f of readdirSync(new URL(".", import.meta.url))) {
    if (!f.endsWith(".test.mjs") || f === "test-port.test.mjs") continue;
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/pickPort\((\d+),\s*(\d+)/g)) ranges.push([f, +m[1], +m[1] + +m[2]]);
    for (const m of src.matchAll(/(\d+)\s*\+\s*Math\.floor\(\s*Math\.random\(\)\s*\*\s*(\d+)/g)) ranges.push([f, +m[1], +m[1] + +m[2]]);
    if (/\bconst PORT\b/.test(src) && !/\bPORT = pickPort\(/.test(src)) assert.fail(`${f} sets PORT without pickPort`);
  }
  assert.ok(ranges.length > 0);
  assertNoOverlap(ranges);
});

test("the overlap check fails when two files share a range", () => {
  assert.throws(() => assertNoOverlap([["a", 4600, 4900], ["b", 4800, 5100]]), /share ports/);
  assert.throws(() => assertNoOverlap([["a", 4600, 4900], ["a", 4800, 5100]]), /share ports/);
  assertNoOverlap([["a", 4600, 4900], ["b", 4900, 5200]]);
});

function assertNoOverlap(ranges) {
  for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
    const [a, a0, a1] = ranges[i], [b, b0, b1] = ranges[j];
    assert.ok(a1 <= b0 || b1 <= a0, `${a} and ${b} share ports`);
  }
}
