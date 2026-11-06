import { test } from "node:test";
import assert from "node:assert/strict";
import { median, parseStream, grade, summarize, renderMarkdown } from "./lib.mjs";

test("median handles odd, even, empty and non-numbers", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([null, 5, undefined]), 5);
});

test("parseStream counts tool calls, tokens and reported cost", () => {
  const text = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "a" }] } }),
    "not json",
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "b" }, { type: "tool_use", name: "c" }] } }),
    JSON.stringify({ type: "result", num_turns: 3, total_cost_usd: 0.12, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } }),
  ].join("\n");
  const r = parseStream(text);
  assert.equal(r.steps, 3); assert.equal(r.turns, 3); assert.equal(r.tokensTotal, 135); assert.equal(r.costUsd, 0.12); assert.ok(r.finished);
});

test("parseStream on a run that never finished", () => {
  const r = parseStream("");
  assert.equal(r.finished, false); assert.equal(r.costUsd, null); assert.equal(r.tokensTotal, 0);
});

const expect = { lines: { a: 2 }, slot_id: "fri-pm", address_contains: "Bonapriso", payment: "cash_on_delivery", promo: null };
const order = { lines: [{ product_id: "a", quantity: 2 }], slot_id: "fri-pm", address: "1 Rue, Bonapriso", payment: "cash_on_delivery", promo: null };

test("grade passes one matching order and fails everything else", () => {
  assert.equal(grade({ orders: [order] }, expect).success, true);
  assert.equal(grade({ orders: [] }, expect).success, false);
  assert.equal(grade({ orders: [order, order] }, expect).success, false);
  assert.match(grade({ orders: [{ ...order, slot_id: "x" }] }, expect).why[0], /slot/);
  assert.match(grade({ orders: [{ ...order, lines: [{ product_id: "a", quantity: 1 }] }] }, expect).why[0], /lines/);
  assert.equal(grade(null, expect).success, false);
});

const runs = [
  { side: "screenshots", run: 1, success: true, seconds: 100, steps: 30, tokensTotal: 900, costUsd: 0.9, why: [] },
  { side: "screenshots", run: 2, success: false, seconds: 200, steps: 50, tokensTotal: 1100, costUsd: 1.1, why: ["0 orders placed (want 1)"] },
  { side: "labelled", run: 1, success: true, seconds: 20, steps: 8, tokensTotal: 100, costUsd: 0.1, why: [] },
  { side: "labelled", run: 2, success: true, seconds: 30, steps: 10, tokensTotal: 120, costUsd: null, why: [] },
];

test("summarize gives medians per side and hides cost when a run lacks one", () => {
  const s = summarize(runs);
  assert.equal(s.screenshots.medianSeconds, 150); assert.equal(s.screenshots.successes, 1);
  assert.equal(s.labelled.medianSteps, 9); assert.equal(s.labelled.medianCostUsd, null);
});

test("renderMarkdown lists every raw run and the medians", () => {
  const md = renderMarkdown({ date: "2026-11-06", runsPerSide: 2, task: "t", agent: "claude", model: null, app: "Tide & Tackle", runs });
  assert.match(md, /\| screenshots \| 2 \| no \|/);
  assert.match(md, /Screenshots and coordinates \| 1\/2 \| 150\.0 \| 40 \|/);
  assert.equal(md.split("\n").filter((l) => /^\| (screenshots|labelled) \|/.test(l)).length, 4);
});

import { claudeArgs } from "./lib.mjs";
test("claudeArgs is the same for both sides except the server", () => {
  const a = claudeArgs({ prompt: "p", mcpConfigPath: "/c.json", serverName: "phone", model: "m" });
  assert.deepEqual(a.slice(0, 2), ["-p", "p"]);
  assert.ok(a.includes("--strict-mcp-config")); assert.equal(a[a.indexOf("--tools") + 1], "");
  assert.equal(a[a.indexOf("--model") + 1], "m");
  assert.ok(!claudeArgs({ prompt: "p", mcpConfigPath: "x", serverName: "phone" }).includes("--model"));
});
