import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { median, max, parseVmRssKb, parsePpid, treeRssMb } from "./stats.mjs";

const status = (ppid, kb) => `Name:\tx\nState:\tS (sleeping)\nPPid:\t${ppid}\nVmPeak:\t  999999 kB\nVmRSS:\t   ${kb} kB\nThreads:\t4\n`;

test("median and max", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(max([3, 9, 2]), 9);
  assert.equal(max([]), null);
});

test("parses VmRSS and PPid from a /proc status fixture", () => {
  const t = status(42, 20480);
  assert.equal(parseVmRssKb(t), 20480);
  assert.equal(parsePpid(t), 42);
  assert.equal(parseVmRssKb("Name:\tkthread\n"), null);
});

test("sums RSS over the process and its descendants only", () => {
  const d = mkdtempSync(join(tmpdir(), "proc-"));
  const add = (pid, ppid, kb) => { mkdirSync(join(d, String(pid))); writeFileSync(join(d, String(pid), "status"), status(ppid, kb)); };
  add(100, 1, 10240); add(101, 100, 20480); add(102, 101, 10240); add(200, 1, 999999);
  assert.equal(treeRssMb(100, d), 40);
  assert.equal(treeRssMb(555, d), null);
  assert.equal(treeRssMb(100, join(d, "missing")), null);
});
