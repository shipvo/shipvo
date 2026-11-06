import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, eventsFrom, main } from "./apply-ios.mjs";

const full = [["publish_start", 1000], ["publish_done", 3000], ["download_start", 3500], ["download_done", 3900], ["healthy", 4400]].map(([name, t]) => ({ name, t }));

test("normal run", () => {
  assert.deepEqual(summarise(full), { publishMs: 2000, downloadMs: 400, applyMs: 500, healthyMs: 1400, totalMs: 3400 });
});
test("missing marker gives null, not 0", () => {
  const r = summarise(full.filter((e) => e.name !== "download_done"));
  assert.equal(r.downloadMs, null);
  assert.equal(r.applyMs, null);
  assert.equal(r.publishMs, 2000);
  assert.equal(r.totalMs, 3400);
});
test("out-of-order markers throw", () => {
  assert.throws(() => summarise([{ name: "publish_start", t: 5000 }, { name: "healthy", t: 4000 }]), /out of order/);
});
test("eventsFrom reads bundle requests after launch", () => {
  const entries = [{ t: 3000, path: "/b/x", bytes: 1 }, { t: 3500, path: "/b/a", bytes: 1 }, { t: 3900, path: "/b/b", bytes: 1 }, { t: 3950, path: "/t", bytes: 1 }];
  const ev = eventsFrom(entries, { publish_start: 1000, publish_done: 3000, app_launched: 3400, healthy: 4400 });
  assert.deepEqual(summarise(ev), { publishMs: 2000, downloadMs: 400, applyMs: 500, healthyMs: 1400, totalMs: 3400 });
});
test("--help and --dry-run need no Simulator", () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: () => {} };
  assert.equal(main(["--help"], io), 0);
  assert.equal(main(["--dry-run"], io), 0);
  assert.equal(JSON.parse(out[1]).dryRun, true);
  assert.equal(main([], io), 2);
});
test("eventsFrom throws when app_launched is missing", () => {
  assert.throws(() => eventsFrom([{ t: 1, path: "/b/x" }], { publish_start: 1, healthy: 2 }), /missing mark app_launched/);
});
test("flags without a value exit 2", () => {
  const err = [];
  const io = { out: () => {}, err: (s) => err.push(s) };
  assert.equal(main(["--server-log", "a", "--marks", "b", "--out"], io), 2);
  assert.equal(main(["--server-log", "--marks", "b"], io), 2);
  assert.match(err.join("\n"), /missing value for --out/);
});
