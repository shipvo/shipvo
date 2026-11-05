// Tests for the helpers in scripts/sim-bench (kept here so `pnpm -r test` runs them).
import test from "node:test";
import assert from "node:assert/strict";
import { median, max, parseVmRssMb, parsePpid, descendants } from "../../scripts/sim-bench/stats.mjs";

test("median and max", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(max([5, 1, 3]), 5);
  assert.equal(max([]), null);
});

const STATUS = "Name:\tchrome\nUmask:\t0022\nVmPeak:\t 2000000 kB\nVmRSS:\t  204800 kB\nRssAnon:\t 100000 kB\nThreads:\t12\n";
test("parseVmRssMb reads VmRSS, not RssAnon", () => {
  assert.equal(parseVmRssMb(STATUS), 200);
  assert.equal(parseVmRssMb("Name:\tkthreadd\nState:\tS\n"), null);
});

test("parsePpid copes with spaces and parentheses in the command name", () => {
  assert.equal(parsePpid("123 (node) S 77 123 123 0 -1"), 77);
  assert.equal(parsePpid("124 (Web Content) (x)) S 123 1 1 0"), 123);
  assert.equal(parsePpid("garbage"), null);
});

test("descendants walks the whole tree", () => {
  const m = new Map([[2, 1], [3, 2], [4, 3], [5, 9]]);
  assert.deepEqual(descendants(1, m).sort(), [1, 2, 3, 4]);
});
