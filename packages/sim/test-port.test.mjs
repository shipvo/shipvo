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
