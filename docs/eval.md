# Score an agent on an app task (`shipvo eval`)

This page is for you if you want to know how well a coding agent or a model uses your app: does it place the order, does it read the error, how many steps does it take. `shipvo eval` gives an agent a task on the Android or iOS simulated phone, records every step, and checks the result against what the app really did. Shipvo measures the score. The agent's own report is not used.

## How it works

1. You write a task file, `tasks/<name>.task.json`.
2. `shipvo eval run` opens a session on the simulator and prints an MCP URL and an instruction.
3. You point the agent at that URL and give it the instruction. Any agent or model that speaks MCP works.
4. The run ends when the agent calls `end_session`, or at the step or time limit.
5. Shipvo checks the app's state (orders, final screen, crashes) and writes the result.

## Run a task

Start the simulator in your app folder (`shipvo sim`, or the hosted phone with `--mcp` and `--key`). The repository ships two tasks on the shop template in `tasks/`.

```bash
shipvo eval run buy-canvas-tote --agent claude --model claude-sonnet-5-5
```

Shipvo prints:

```text
Eval run ready.
MCP URL for the agent: http://127.0.0.1:<port>/mcp
Session: eval-buy-canvas-tote-claude-<time>

Give the agent this instruction:
Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
Use session "eval-buy-canvas-tote-claude-<time>" in every tool call. The run ends when the agent calls end_session, after 40 steps or after 300 seconds.
```

When the run ends you see one line per result and one per check:

```text
PASS buy-canvas-tote (claude) ended by agent: 12 steps, 41s, 0 errors, 0 retries
  ok   order: 1 matching order(s)
  ok   confirmation: "Order placed" on the final screen
  ok   no-crash: no crash
Steps: .shipvo/eval/buy-canvas-tote-claude-<time>/steps.jsonl
```

The numbers above show the format. Yours differ. The exit code is 0 for a pass and 1 for a fail.

### Options

| Option | What it does |
| --- | --- |
| `<task>` | A task name (`tasks/<name>.task.json`) or a path to a `.json` file |
| `--agent <name>` | Required. A label for the agent, used in the report |
| `--model <name>` | The model, shown in the report |
| `--mcp <url>` | The MCP server to use. Default `http://localhost:8787/mcp`, or `SHIPVO_EVAL_MCP` |
| `--key <key>` | A Shipvo key for a hosted server, or `SHIPVO_EVAL_KEY` |
| `--port <n>` | Port for the URL you give the agent. Default: any free port |
| `--dir <path>` | Where runs are saved. Default `.shipvo/eval` |
| `--json` | Print the result as the usual `{ ok, code, summary, data, next }` envelope |

## The task file

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

- `name`, `app`, `instruction`, `platform` (`android` or `ios`), `limits` and at least one check are required.
- `start.seed_cart` fills the cart. `start.device` and `start.network` are applied with `set_device` before the agent begins.
- `limits.steps` and `limits.seconds` must be above 0.

### Checks

| Type | Passes when |
| --- | --- |
| `order_exists` | An order with every listed item exists. `items` take `id` or `name`, and an optional `quantity`. With `count`, the number of orders must match exactly |
| `screen_shown` or `text_present` | `text` is on the final screen (not case sensitive) |
| `text_absent` | `text` is not on the final screen |
| `text_seen` | `text` was shown at any step |
| `no_crash` | No step reported a crash |

An unknown check type is refused when the task loads.

## What is measured

Each run is saved in `.shipvo/eval/<run id>/` as `run.json` and `steps.jsonl` (one line per tool call). `run.json` holds:

- `pass`, and one result per check.
- `ended`: `agent`, `step_limit` or `time_limit`.
- `steps`, `seconds`, `errors` (calls that failed) and `retries` (the same call repeated right after it failed).
- `findings`: each error code with the tool and a count.
- `recording`: the video file, if the agent ran `record_stop`.

## Compare runs

```bash
shipvo eval report
shipvo eval report --out report.md
```

The report groups runs by agent, model and task: runs, pass rate, median steps, median seconds, and a link to the steps (and recording) of each run. `--out` writes the Markdown file and a `.json` copy beside it. `--json` prints the rows.

## Troubleshooting

**`no task "x": expected tasks/x.task.json`.** The task name has no file. Check the folder you run from, or pass the path.

**`open_app failed at the start of the run`.** The MCP server is not running or does not know the app. Start `shipvo sim` first, or pass `--mcp` and `--key` for a hosted server.

**`410 the eval run is over`.** The agent kept calling after the run ended. Start a new run.

**The run ended by `time_limit` or `step_limit`.** The agent did not call `end_session` in time. Shipvo reads the screen and orders itself and scores what it finds. Raise `limits` in the task if the limit was too tight.

**A call with another session id is not counted.** Tell the agent to use the session id printed at the start in every call.

## Next steps

- [Agents and Shipvo apps](agents.md): every MCP tool the agent can use.
- [Typed tests](testing.md): turn a good run into a test with `export_test`.
- [Record demo videos](record.md): have the agent record its run.
