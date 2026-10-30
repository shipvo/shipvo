#!/usr/bin/env node
// Create fresh session files for each task (with any seeded cart). Usage: node agent-eval/seed.mjs <dir>
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initialState } from "../src/domain/shop.ts";
const dir = process.argv[2] || "/tmp/pn-eval"; mkdirSync(dir, { recursive: true });
for (const t of JSON.parse(readFileSync(new URL("./tasks.json", import.meta.url), "utf8"))) {
  const s = initialState(); if (t.seed_cart) s.cart = t.seed_cart;
  writeFileSync(join(dir, `${t.id}.json`), JSON.stringify(s)); rmSync(join(dir, `${t.id}.json.log`), { force: true });
}
console.log("seeded", dir);
