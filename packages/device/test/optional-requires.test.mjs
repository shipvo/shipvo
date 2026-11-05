// Metro only treats a require() as optional when it sits directly in a try block, not inside a function.
// A require inside an arrow function broke `shipvo publish` on apps without expo-contacts (#332).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const lines = src.split("\n").filter((l) => /require\(\s*["']/.test(l));

test("index.ts has optional requires", () => assert.ok(lines.length >= 8));

for (const l of lines) {
  test(`require is directly inside try/catch: ${l.trim().slice(0, 60)}`, () => {
    assert.match(l, /^\s*try\s*\{[^{}]*\brequire\(\s*["'][^"']+["']\s*\)[^{}]*\}\s*catch\b/);
    assert.doesNotMatch(l, /=>|function/);
  });
}

test("every optional peer dependency is required", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of Object.keys(pkg.peerDependenciesMeta)) assert.ok(src.includes(`require("${name}")`), name);
});
