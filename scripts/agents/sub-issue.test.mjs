import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./sub-issue.mjs";

test("epic and issues, with or without #", () => {
  assert.deepEqual(parseArgs(["878", "#1114", "1115"]), { epic: 878, issues: [1114, 1115] });
});
test("--list", () => {
  assert.deepEqual(parseArgs(["#878", "--list"]), { epic: 878, list: true });
});
test("bad input is refused with a message", () => {
  assert.ok(parseArgs([]).error);
  assert.ok(parseArgs(["878"]).error);
  assert.ok(parseArgs(["878", "abc"]).error);
  assert.ok(parseArgs(["878", "878"]).error);
});
