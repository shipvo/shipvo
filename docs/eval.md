# Score an agent on your app (`shipvo eval`)

This page is for developers who want to know how well a coding agent or model uses their app. You will run one agent on one task, get a pass or fail that Shipvo measures, and compare runs in a report. Every task runs on Android or iOS.

Shipvo does not call any model. `shipvo eval run` opens a phone session, then starts a recording MCP address. Your agent connects to that address like any other MCP server. When the run ends, Shipvo checks the result itself, so the score does not depend on what the agent says it did.

## Run a task

1. Start the Shipvo MCP server (the default address is `http://localhost:8787/mcp`; set `--mcp` or `SHIPVO_EVAL_MCP` to use another).
2. Pick a task file. Two sample tasks for the shop template are in `tasks/`: `buy-canvas-tote` (Android) and `declined-card-then-pay` (iOS).
3. Run it:

```bash
npx shipvo eval run buy-canvas-tote --agent claude --model claude-sonnet-5-5
```

4. Shipvo prints an MCP URL, a session name and the task instruction. Point your agent at that URL, give it the instruction, and tell it to use that session in every tool call.
5. The run ends when the agent calls `end_session`, after the task's step limit, or after its time limit.

Expected output:

```text
PASS buy-canvas-tote (claude) ended by agent: 12 steps, 41s, 0 errors, 0 retries
  ok   order: 1 matching order(s)
  ok   confirmation: "Order placed" on the final screen
  ok   no-crash: no crash
Steps: .shipvo/eval/buy-canvas-tote-claude-20261107120000/steps.jsonl
```

The numbers above show the format. Your run prints its own. The exit code is 0 on pass and 1 on fail.

## Options

| Option | What it does |
| --- | --- |
| `--agent <name>` | Required. A label for the agent, such as `claude` or `cursor`. |
| `--model <name>` | Optional label for the model. Runs are grouped by agent, model and task. |
| `--mcp <url>` | The Shipvo MCP server to score against. Default `http://localhost:8787/mcp`, or `SHIPVO_EVAL_MCP`. |
| `--key <key>` | Bearer key for the MCP server, or `SHIPVO_EVAL_KEY`. |
| `--port <n>` | Port for the recording address. Default: a free port. |
| `--dir <path>` | Where runs are saved. Default `.shipvo/eval`. |
| `--json` | Print the result as a JSON envelope. |

`<task>` is a path to a `.json` file, or a name that resolves to `tasks/<name>.task.json`.

## Write a task

A task is a JSON file:

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

Required: `name`, `app`, `platform` (`android` or `ios`), `instruction`, `limits.seconds`, `limits.steps` (both above 0) and at least one check. `start.seed_cart` fills the cart; `start.device` and `start.network` are passed to `set_device` before the agent starts.

### Checks

| Type | Passes when |
| --- | --- |
| `order_exists` | An order contains every item in `items` (match by `id` or `name`, optionally `quantity`). With `count`, the total number of orders must equal it. |
| `screen_shown` or `text_present` | `text` is on the final screen (not case sensitive). |
| `text_absent` | `text` is not on the final screen. |
| `text_seen` | `text` appeared in any step's output, for messages that come and go, such as a declined payment. |
| `no_crash` | No step reported a crash. |

The run passes only when every check passes.

## What is measured

Each run saves `run.json` and `steps.jsonl` in `.shipvo/eval/<run id>/`:

- pass or fail for each check, with a detail line;
- steps, seconds, errors and retries (the same failing call repeated with the same arguments);
- findings: each failing tool call grouped by tool and error code, with counts;
- how the run ended: `agent`, `step_limit` or `time_limit`;
- the recording path, if the agent used `record_start` and `record_stop` (see [Record a demo video](record.md)).

## Compare runs

```bash
npx shipvo eval report --out eval.md
```

The report groups runs by agent, model and task and shows the pass rate, the median steps and the median seconds, with a link to each run's steps and recording. `--out eval.md` writes the Markdown and a matching `eval.json`; `--json` prints the rows.

## Troubleshooting

- **`no task "x": expected tasks/x.task.json`**: pass a path to the file, or put it in `tasks/` with the `.task.json` ending.
- **`open_app failed at the start of the run`**: the MCP server is not running at `--mcp`, or the key is wrong. Start it, or pass `--key`.
- **`unknown check type`**: use one of the types in the table above.
- **The agent gets `the eval run is over`**: the step or time limit ended the run. Raise `limits` in the task.
- **Calls in other sessions are not scored**: use the session name Shipvo printed in every tool call.

## Next steps

- [Agents and Shipvo apps](agents.md): the tools your agent can call.
- [Test your app in CI](testing.md): turn what an agent did into a typed test with `export_test`.
- [Record a demo video](record.md): attach a recording to a run.
