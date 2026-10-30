#!/usr/bin/env node
// Grade agent runs: each session must contain exactly one placed order matching the task's expectations.
// Usage: node agent-eval/grade.mjs <sessions-dir>
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2] || "/tmp/pn-eval";
const tasks = JSON.parse(readFileSync(new URL("./tasks.json", import.meta.url), "utf8"));
let pass = 0; const rows = [];
for (const t of tasks) {
  const f = join(dir, `${t.id}.json`), log = f + ".log";
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const secs = calls.length > 1 ? (calls.at(-1).at - calls[0].at) / 1000 : 0;
  const errors = calls.filter((c) => !c.ok).length;
  const why = [];
  if (!existsSync(f)) why.push("no session");
  else {
    const s = JSON.parse(readFileSync(f, "utf8")); const e = t.expect;
    if (s.orders.length !== 1) why.push(`${s.orders.length} orders placed (want 1)`);
    const o = s.orders[0];
    if (o) {
      const got = Object.fromEntries(o.lines.map((l) => [l.product_id, l.quantity]));
      if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(e.lines).sort())) why.push(`lines ${JSON.stringify(got)} want ${JSON.stringify(e.lines)}`);
      if (o.slot_id !== e.slot_id) why.push(`slot ${o.slot_id} want ${e.slot_id}`);
      if (e.address_contains && !o.address.toLowerCase().includes(e.address_contains.toLowerCase())) why.push(`address '${o.address}'`);
      if (o.payment !== e.payment) why.push(`payment ${o.payment}`);
      if (e.phone && o.phone !== e.phone) why.push(`phone ${o.phone}`);
      if ((o.promo ?? null) !== e.promo) why.push(`promo ${o.promo} want ${e.promo}`);
    }
  }
  const ok = why.length === 0; if (ok) pass++;
  rows.push({ task: t.id, result: ok ? "PASS" : "FAIL", calls: calls.length, failed_calls: errors, seconds: +secs.toFixed(1), why: why.join("; ") });
}
console.table(rows);
const rate = pass / tasks.length;
console.log(`\nSuccess: ${pass}/${tasks.length} = ${(rate * 100).toFixed(0)}%  (kill gate: >= 70%)  -> ${rate >= 0.7 ? "PASS" : "KILL"}`);
console.log(JSON.stringify({ pass, total: tasks.length, rate, rows }));
