// The agent jobs benchmark: its jobs, its task text, its scoring and its totals. No agent runs here.
import test from "node:test";
import assert from "node:assert/strict";
import { JOBS, VARIANTS, builtInSides, finalReport, prompt, score, summarize, table } from "./agent-jobs.mjs";
import { CASES } from "./cases.mjs";

const job = (id) => JOBS.find((j) => j.id === id);

test("every job is a case of the benchmark app, and both variants are run", () => {
  const ids = new Set(CASES.map((c) => c.id));
  for (const j of JOBS) assert.ok(ids.has(j.id), `${j.id} is not a case`);
  assert.equal(new Set(JOBS.map((j) => j.id)).size, JOBS.length);
  assert.deepEqual(VARIANTS, ["buggy", "fixed"]);
});

test("the task text gives the session and what the screen should do, and never which variant is open", () => {
  const p = prompt(job("cart-total"), "job-1");
  assert.match(p, /Phone session: job-1\./);
  assert.match(p, /The total is the price, 1500, times the quantity\./);
  assert.match(p, /VERDICT: BUG/); assert.match(p, /VERDICT: OK/);
  assert.doesNotMatch(p, /buggy|fixed|seeded/i);
});

test("a buggy screen passes only on VERDICT: BUG that names the bug", () => {
  const j = job("cart-total");
  assert.deepEqual(score(j, "buggy", "Tapped Increase twice. Total stayed 1500.\nVERDICT: BUG"), { pass: true, verdict: "BUG", why: "" });
  assert.equal(score(j, "buggy", "Looks fine.\nVERDICT: OK").why, "missed the seeded bug");
  assert.equal(score(j, "buggy", "Something is off with the colours.\nVERDICT: BUG").why, "said BUG without naming the seeded bug");
});

test("a fixed screen passes only on VERDICT: OK", () => {
  const j = job("cart-total");
  assert.equal(score(j, "fixed", "Total went 1500, 3000, 4500.\nVERDICT: OK").pass, true);
  assert.deepEqual(score(j, "fixed", "The total looks wrong.\nVERDICT: BUG"), { pass: false, verdict: "BUG", why: "reported a bug on the fixed screen" });
});

test("the last VERDICT line counts, bold or not, and a report without one fails", () => {
  const j = job("empty-form");
  assert.equal(score(j, "fixed", "The format is VERDICT: BUG or OK.\n**VERDICT: OK**").verdict, "OK");
  assert.equal(score(j, "buggy", "An empty email was accepted.").why, "the report has no VERDICT line");
  assert.equal(score(j, "buggy", undefined).pass, false);
});

test("totals sum each job-and-variant's median, and count bugs found and false alarms", () => {
  const r = (side, jobId, variant, pass, verdict, tokens, calls, seconds) => ({ side, job: jobId, variant, pass, verdict, tokens, calls, seconds });
  const totals = summarize([
    r("a", "cart-total", "buggy", true, "BUG", 100, 4, 10), r("a", "cart-total", "buggy", true, "BUG", 300, 6, 30),
    r("a", "cart-total", "fixed", false, "BUG", 50, 2, 5),
    r("b", "cart-total", "buggy", false, "OK", 900, 9, 90),
  ]);
  assert.deepEqual(totals[0], { side: "a", runs: 3, passed: 2, bugs_found: 2, buggy_runs: 2, false_alarms: 1, fixed_runs: 1, tokens: 250, calls: 7, seconds: 25 });
  assert.equal(totals[1].bugs_found, 0);
  assert.match(table(totals), /a\s+2\/3\s+2\/2\s+1\/1\s+250\s+7\s+25/);
});

test("the final report is the result text of the agent's stream", () => {
  const out = [JSON.stringify({ type: "assistant", message: { content: [] } }), "not json", JSON.stringify({ type: "result", result: "done\nVERDICT: OK" })].join("\n");
  assert.equal(finalReport(out), "done\nVERDICT: OK");
  assert.equal(finalReport(""), "");
});

test("the built-in sides are the same server: as it ships, sending whole screens, and with its core tools only", () => {
  const [a, b, c] = builtInSides("http://localhost:1");
  assert.equal(c.name, "core-tools"); assert.equal(c.config.mcpServers.phone.env.SHIPVO_MCP_TOOLS, "core");
  assert.equal(a.name, "changed-lines"); assert.equal(b.name, "full-screen");
  assert.equal(a.config.mcpServers.phone.env.SHIPVO_MCP_FULL_SCREEN, undefined);
  assert.equal(b.config.mcpServers.phone.env.SHIPVO_MCP_FULL_SCREEN, "1");
  assert.equal(a.config.mcpServers.phone.env.PN_SIM, "http://localhost:1");
});
