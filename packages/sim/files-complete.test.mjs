import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const listed = new Set(pkg.files.map((f) => normalize(f)));
const IMPORT = /(?:from\s*|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;

test("every relative module imported by a packed file is also packed", () => {
  const seen = new Set();
  const missing = [];
  const queue = [...listed].filter((f) => /\.m?js$/.test(f));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(existsSync(join(root, file)), `${file} is in "files" but does not exist`);
    const src = readFileSync(join(root, file), "utf8");
    for (const m of src.matchAll(IMPORT)) {
      const target = normalize(join(dirname(file), m[1]));
      if (!listed.has(target)) missing.push(`${file} imports ${target}`);
      else queue.push(target);
    }
  }
  assert.deepEqual(missing, []);
});
