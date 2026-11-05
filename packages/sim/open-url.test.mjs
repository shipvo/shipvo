import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The sim needs a browser to run, so check that the action is wired and returns the typed error.
const src = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
test("open_url is an action and fails with no_url_listener when nothing handled the URL", () => {
  assert.match(src, /case "open_url"/);
  assert.match(src, /__pnDevice\?\.openUrl\(u\)/);
  assert.match(src, /new SimError\("no_url_listener"/);
});
