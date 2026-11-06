// Pure helpers for the agent-efficiency benchmark (#837). No model, no network: all of this is unit tested.
export const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Read the Claude Code `--output-format stream-json` output. Counts model tokens from the final `result` event
// (all four kinds, summed across turns), tool calls as steps, and keeps the cost the CLI itself reports.
export function parseStream(text) {
  let steps = 0, result = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "assistant") for (const c of ev.message?.content ?? []) if (c.type === "tool_use") steps++;
    if (ev.type === "result") result = ev;
  }
  const u = result?.usage ?? {};
  const tokens = {
    input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  return {
    finished: !!result, steps, turns: result?.num_turns ?? null, tokens,
    tokensTotal: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
    costUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
  };
}

// Grade one finished session against the task's expectations. Same rules as apps/tide-and-tackle/agent-eval/grade.mjs.
export function grade(session, expect) {
  const why = [];
  const orders = session?.orders ?? [];
  if (orders.length !== 1) why.push(`${orders.length} orders placed (want 1)`);
  const o = orders[0];
  if (o) {
    const got = Object.fromEntries(o.lines.map((l) => [l.product_id, l.quantity]));
    if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(expect.lines).sort())) why.push(`lines ${JSON.stringify(got)} want ${JSON.stringify(expect.lines)}`);
    if (o.slot_id !== expect.slot_id) why.push(`slot ${o.slot_id} want ${expect.slot_id}`);
    if (expect.address_contains && !String(o.address ?? "").toLowerCase().includes(expect.address_contains.toLowerCase())) why.push(`address '${o.address}'`);
    if (o.payment !== expect.payment) why.push(`payment ${o.payment}`);
    if (expect.phone && o.phone !== expect.phone) why.push(`phone ${o.phone}`);
    if ((o.promo ?? null) !== (expect.promo ?? null)) why.push(`promo ${o.promo} want ${expect.promo}`);
  }
  return { success: why.length === 0, why };
}

const sideRuns = (runs, side) => runs.filter((r) => r.side === side);
export function summarize(runs) {
  const out = {};
  for (const side of ["screenshots", "labelled"]) {
    const rs = sideRuns(runs, side);
    const costs = rs.map((r) => r.costUsd).filter((x) => x !== null && x !== undefined);
    out[side] = {
      runs: rs.length, successes: rs.filter((r) => r.success).length,
      medianSeconds: median(rs.map((r) => r.seconds)), medianSteps: median(rs.map((r) => r.steps)),
      medianTokens: median(rs.map((r) => r.tokensTotal)), medianCostUsd: costs.length === rs.length ? median(costs) : null,
    };
  }
  return out;
}

const n = (x, d = 0) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(d));
// Markdown for docs/agent-efficiency.md. Says what was measured; the numbers come only from the runs file.
export function renderMarkdown(data) {
  const s = summarize(data.runs);
  const row = (label, side) => `| ${label} | ${s[side].successes}/${s[side].runs} | ${n(s[side].medianSeconds, 1)} | ${n(s[side].medianSteps)} | ${n(s[side].medianTokens)} | ${s[side].medianCostUsd === null ? "n/a" : "$" + n(s[side].medianCostUsd, 3)} |`;
  const raw = data.runs.map((r) => `| ${r.side} | ${r.run} | ${r.success ? "yes" : "no"} | ${n(r.seconds, 1)} | ${r.steps} | ${r.tokensTotal} | ${r.costUsd === null ? "n/a" : "$" + n(r.costUsd, 3)} | ${r.why?.join("; ") ?? ""} |`);
  return [
    "# Agent efficiency: screenshots and coordinates, or the labelled screen",
    "",
    `One task, done two ways by the same agent with the same model and settings. Measured ${data.date} (${data.runsPerSide} runs per side).`,
    "",
    `- Task: ${data.task}`,
    `- Agent: \`${data.agent}\`, model setting: ${data.model ?? "default of the CLI"}.`,
    `- App: ${data.app}, in the Shipvo phone simulator.`,
    "- **Screenshots side:** the agent gets a screenshot tool and coordinate taps, nothing else.",
    "- **Labelled side:** the agent gets Shipvo's labelled screen tree and typed actions (`@shipvo/mcp`).",
    "- Steps are tool calls. Tokens are input, output and cache tokens summed over the run. Cost is the estimate the agent CLI reports.",
    "- Success means the app holds exactly one order that matches the task.",
    "",
    "## Median of the runs",
    "",
    "| Side | Success | Seconds | Steps | Tokens | Est. cost |",
    "| --- | --- | --- | --- | --- | --- |",
    row("Screenshots and coordinates", "screenshots"),
    row("Labelled screen and typed actions", "labelled"),
    "",
    "## Raw runs",
    "",
    "| Side | Run | Success | Seconds | Steps | Tokens | Est. cost | Why not |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...raw, "",
    "Raw data: [agent-efficiency-runs.json](agent-efficiency-runs.json). Harness: `scripts/agent-efficiency/`.", "",
  ].join("\n");
}

// The agent command line. Identical for both sides except which MCP server it is given. Built-in tools are switched off
// so the agent can only use the phone tools.
export function claudeArgs({ prompt, mcpConfigPath, serverName, model }) {
  return ["-p", prompt, "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config", mcpConfigPath,
    "--tools", "", "--allowedTools", `mcp__${serverName}`, "--permission-mode", "dontAsk", ...(model ? ["--model", model] : [])];
}
export const TASK_PREFIX = "You are using a phone through the tools you have. The shop app is already open. Finish this task, then say done.\n\n";
