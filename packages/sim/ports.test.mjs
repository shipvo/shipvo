// Every sim test file that starts a server must use its own port range.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("port ranges in packages/sim tests do not overlap", () => {
  const ranges = [];
  for (const f of readdirSync(here).filter((n) => n.endsWith(".test.mjs") && n !== "ports.test.mjs")) {
    const src = readFileSync(join(here, f), "utf8");
    const m = src.match(/^const PORT = (?:pickPort\((\d+), (\d+)\)|(\d+) \+ Math\.floor\(Math\.random\(\) \* (\d+)\))/m);
    if (!m) continue;
    const base = Number(m[1] ?? m[3]);
    ranges.push({ f, base, end: base + Number(m[2] ?? m[4]) });
  }
  assert.ok(ranges.length > 10);
  ranges.sort((a, b) => a.base - b.base);
  for (let i = 1; i < ranges.length; i++) {
    assert.ok(ranges[i].base >= ranges[i - 1].end, `${ranges[i - 1].f} and ${ranges[i].f} overlap`);
  }
});
