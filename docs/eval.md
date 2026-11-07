# Score an agent on your app

This page is for developers and teams who want to know how well a coding or shopping agent uses their app. You write a task, point any agent at it, and `shipvo eval` records every step and scores the result from what the app received, not from what the agent says.

Shipvo never calls a model for you. You run the agent. Shipvo sits between the agent and the simulator, writes down each tool call, and checks the outcome.

## Before you start

- A running MCP server for your app (local `shipvo mcp` or the hosted one). See [Agents and Shipvo apps](agents.md).
- An agent that can connect to an MCP server by URL.
- A task file in `tasks/<name>.task.json`. Two samples for the shop template are in the repository: `buy-canvas-tote` (Android) and `declined-card-then-pay` (iOS).

## Run a task

1. Start the run. It opens a fresh session with the starting state from the task and prints a proxy URL:

   ```bash
   shipvo eval run buy-canvas-tote --agent my-agent --model demo --mcp http://localhost:8787/mcp
   ```

   ```text
   Eval run ready.
   MCP URL for the agent: http://127.0.0.1:52114/mcp
   Session: eval-buy-canvas-tote-my-agent-20261107120545

   Give the agent this instruction:
   Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
   Use session "eval-buy-canvas-tote-my-agent-20261107120545" in every tool call. The run ends when the agent calls end_session, after 40 steps or after 300 seconds.
   ```

2. Connect your agent to the printed MCP URL and give it the instruction. It must pass the printed session in every tool call.
3. The run ends when the agent calls `end_session`, or at the step or time limit. Shipvo then scores it:

   ```text
   PASS buy-canvas-tote (my-agent) ended by agent: 2 steps, 2s, 0 errors, 0 retries
     ok   order: 1 matching order(s)
     ok   confirmation: "Order placed" on the final screen
     ok   no-crash: no crash
   Steps: .shipvo/eval/buy-canvas-tote-my-agent-20261107120545/steps.jsonl
   ```

   The exit code is 0 on pass and 1 on fail.

Options for `shipvo eval run <task>`:

| Option | What it does |
| --- | --- |
| `--agent <name>` | Required. A label for the agent, used in the report. |
| `--model <name>` | A label for the model, used in the report. |
| `--mcp <url>` | The MCP server to run on. Default `http://localhost:8787/mcp`, or `SHIPVO_EVAL_MCP`. |
| `--key <key>` | API key for a hosted server, or `SHIPVO_EVAL_KEY`. |
| `--port <n>` | Port for the proxy. Default: any free port. |
| `--dir <path>` | Where runs are saved. Default `.shipvo/eval`. |
| `--json` | Print the result as JSON. |

Each run writes `run.json` (the score) and `steps.jsonl` (every tool call with its result) under `.shipvo/eval/<run>/`. If the agent calls `record_stop`, the report links the recording.

## Write a task

```json
{
  "name": "buy-canvas-tote",
  "app": "shop",
  "platform": "android",
  "instruction": "Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.",
  "start": {
    "seed_cart": [],
    "device": { "payment": { "nextResult": "approve", "pin": "1234" } },
    "network": { "online": true }
  },
  "limits": { "seconds": 300, "steps": 40 },
  "checks": [
    { "id": "order", "type": "order_exists", "items": [{ "id": "canvas-tote", "quantity": 1 }], "count": 1 },
    { "id": "confirmation", "type": "screen_shown", "text": "Order placed" },
    { "id": "no-crash", "type": "no_crash" }
  ]
}
```

`name`, `app`, `platform` (`android` or `ios`), `instruction`, `limits.seconds`, `limits.steps` and at least one check are required. `start` is optional: `seed_cart` fills the cart, `device` and `network` are applied with `set_device` before the agent starts.

### Checks

| Type | Passes when |
| --- | --- |
| `order_exists` | An order contains every listed item (`id` or `name`, optional `quantity`). With `count`, the number of orders must match exactly. |
| `screen_shown` or `text_present` | `text` is on the final screen (not case sensitive). |
| `text_absent` | `text` is not on the final screen. |
| `text_seen` | `text` appeared on screen at any step. |
| `no_crash` | No step reported a crash. |

## Compare runs

```bash
shipvo eval report
shipvo eval report --json
shipvo eval report --out report.md   # also writes report.json
```

```text
| Agent | Model | Task | Runs | Pass rate | Median steps | Median seconds | Runs (steps, recording) |
|---|---|---|---|---|---|---|---|
| my-agent | demo | buy-canvas-tote | 1 | 1/1 (100%) | 2 | 2 | [pass](.shipvo/eval/buy-canvas-tote-my-agent-20261107120545/steps.jsonl) |
```

One row per agent, model and task. `run.json` also lists findings: each failing tool call by error code and how often it happened. A retry is the same failing call sent again with the same arguments.

## Troubleshooting

**`no task "x": expected tasks/x.task.json`.** The file is missing. Put it in `tasks/` in the folder where you run the command, or pass a path ending in `.json`.

**`open_app failed at the start of the run`.** The MCP server refused the session. Check `--mcp`, and `--key` for a hosted server. The message after the colon is the server's own error.

**The run ends by `step_limit` or `time_limit`.** The agent did not call `end_session` in time. Shipvo reads the screen and orders itself and scores what is there. Raise `limits` if the task needs more steps.

**Steps are missing from `steps.jsonl`.** Calls with a different `session` than the one printed are not recorded. Make sure the agent uses the printed session in every call.

**`the eval run is over` (HTTP 410).** The agent kept calling after the run ended. Start a new run.

## Next steps

- [Agents and Shipvo apps](agents.md): the tools an agent has, and how sessions and rooms work.
- [Agent gate results](agent-gate-results.md): how agents scored on real purchase tasks.
- [Record a demo video](record.md): the recording a report links to.
