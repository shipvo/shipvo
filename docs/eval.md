# Score an agent on app tasks (`shipvo eval`)

For developers who want to know how well a coding agent or a model uses their app. You will give an agent a task, such as "buy a Canvas tote", and get back a pass or fail that Shipvo measured from what the app received, plus steps, time, errors and retries. Works on Android and iOS phones.

Shipvo never calls a model itself. It opens a phone session, puts a recording proxy in front of the MCP server, and you point any agent at the proxy.

## Before you start

- A simulator MCP server: `npx @shipvo/mcp --http 8787` on your machine, or the hosted one (`--mcp https://sim.shipvo.dev/mcp --key <your key>`).
- A task file in `tasks/`. Two ship with the shop template: `tasks/buy-canvas-tote.task.json` (Android) and `tasks/declined-card-then-pay.task.json` (iOS).

## 1. Run a task

```bash
shipvo eval run buy-canvas-tote --agent claude --model my-model
```

The default server is `http://localhost:8787/mcp`. Change it with `--mcp <url>` or `SHIPVO_EVAL_MCP`; the key comes from `--key` or `SHIPVO_EVAL_KEY`.

The command opens a fresh session with the task's starting state and prints:

```
Eval run ready.
MCP URL for the agent: http://127.0.0.1:<port>/mcp
Session: eval-buy-canvas-tote-claude-<timestamp>

Give the agent this instruction:
Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
Use session "eval-..." in every tool call. The run ends when the agent calls end_session, after 40 steps or after 300 seconds.
```

## 2. Let the agent work

Connect your agent to the printed MCP URL and give it the instruction. The run ends when the agent calls `end_session`, or at the step or time limit. Then Shipvo scores it:

```
PASS buy-canvas-tote (claude) ended by agent: 9 steps, 41s, 0 errors, 0 retries
  ok   order: 1 matching order(s)
  ok   confirmation: "Order placed" on the final screen
  ok   no-crash: no crash
Steps: .shipvo/eval/<run>/steps.jsonl
```

(The numbers above show the format, not a measurement.) Exit code is 0 on pass and 1 on fail. Add `--json` for a machine-readable result.

Each run writes `run.json` and `steps.jsonl` under `.shipvo/eval/<run>/` (change the folder with `--dir`).

## 3. Compare runs

```bash
shipvo eval report
shipvo eval report --out report.md
```

One row per agent, model and task: pass rate, median steps, median seconds, and a link to each run's steps and recording (from `record_stop`). `--out` also writes a `.json` file next to the Markdown; `--json` prints it.

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

| Field | Meaning |
| --- | --- |
| `name`, `app`, `instruction` | Required. `app` is what `open_app` opens. |
| `platform` | `android` or `ios`. |
| `start` | Optional starting state: `seed_cart`, `device` settings (payment result, PIN) and `network`. |
| `limits` | Required. `seconds` and `steps`, both above zero. |
| `checks` | Required. At least one. |

| Check | Passes when |
| --- | --- |
| `order_exists` | The app posted an order with those `items` (by `id` or `name`, optional `quantity`). `count` is the exact number of orders. |
| `screen_shown` / `text_present` | The text is on the final screen. |
| `text_absent` | The text is not on the final screen. |
| `text_seen` | The text appeared at any step. |
| `no_crash` | No step reported a crash. |

Orders come from what the app sent to its backend, not from what the agent says.

## Troubleshooting

- **`no task "x": expected tasks/x.task.json`.** Run from the project folder, or pass the path to the file.
- **`open_app failed at the start of the run`.** The MCP server is not up or the key is wrong. Check `--mcp` and `--key`.
- **`the eval run is over` (HTTP 410).** The agent kept calling after the run ended. Start a new run.
- **Run ended by `step_limit` or `time_limit`.** Raise `limits`, or read `steps.jsonl` to see where the agent got stuck. Repeated failing calls count as retries.

## Next steps

- [Agents and Shipvo apps](agents.md): the tools an agent can call.
- [Record demo videos](record.md): the recording linked from the report.
- [Testing](testing.md): turn a good run into a typed test.
