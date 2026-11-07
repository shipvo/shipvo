# Score an agent on an app task (`shipvo eval`)

This page is for developers and teams who want to know how well a coding agent or model can use their app, on Android and iOS. You give the agent a task, such as "buy one Canvas tote". Shipvo records every step the agent takes and scores the result with checks you write. You get pass rate, steps, time, errors and retries that Shipvo measured, not the agent's own report.

Shipvo never calls a model. It opens a phone session and puts a recording proxy in front of the MCP server. Your agent connects to the proxy the usual way. Any agent that speaks MCP works.

## Before you start

- The Shipvo MCP server is running (`shipvo mcp`, or a hosted URL). Default: `http://localhost:8787/mcp`.
- An agent that can connect to an MCP URL. See [agents](agents.md).

## Run a task

1. Pick a task. Two samples for the shop template are in `tasks/`:
   - `buy-canvas-tote` (Android): buy one tote and pay.
   - `declined-card-then-pay` (iOS): the first payment is declined; the agent must recover and place one order.
2. Start the run:

   ```bash
   shipvo eval run buy-canvas-tote --agent claude --model <model-name>
   ```

3. Shipvo prints the proxy URL, the session name and the instruction:

   ```text
   Eval run ready.
   MCP URL for the agent: http://127.0.0.1:<port>/mcp
   Session: eval-buy-canvas-tote-claude-<timestamp>

   Give the agent this instruction:
   Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
   ```

4. Point your agent at that URL, give it the instruction, and tell it to use the session name in every tool call.
5. The run ends when the agent calls `end_session`, or at the step limit or time limit. Shipvo then scores the checks and prints the result:

   ```text
   PASS buy-canvas-tote (claude) ended by agent: <steps> steps, <seconds>s, 0 errors, 0 retries
     ok   order: 1 matching order(s)
     ok   confirmation: "Order placed" on the final screen
     ok   no-crash: no crash
   Steps: .shipvo/eval/<run>/steps.jsonl
   ```

The command exits `0` when every check passes and `1` when any fails, so you can use it in CI.

### Options

| Option | Meaning |
| --- | --- |
| `<task>` | Task name (reads `tasks/<name>.task.json`) or a path to a `.json` file. |
| `--agent <name>` | Required. A label for who is being scored. |
| `--model <name>` | Optional. Shown in the report. |
| `--mcp <url>` | MCP server to use. Also `SHIPVO_EVAL_MCP`. Default `http://localhost:8787/mcp`. |
| `--key <key>` | Bearer key for the MCP server. Also `SHIPVO_EVAL_KEY`. |
| `--port <n>` | Port for the proxy. Default: a free port. |
| `--dir <path>` | Where runs are saved. Default `.shipvo/eval`. |
| `--json` | Print the result as JSON. |

Each run writes `run.json` and `steps.jsonl` under `.shipvo/eval/<run>/`. If the agent used `record_start` and `record_stop`, the report links the recording too ([record](record.md)).

## Compare runs

```bash
shipvo eval report
shipvo eval report --json
shipvo eval report --out eval.md
```

The report has one row per agent, model and task: runs, pass rate, median steps, median seconds, and a link to each run's steps (and recording). `--out eval.md` also writes `eval.json` next to it.

## Write your own task

A task is `tasks/<name>.task.json`:

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

- `name`, `app`, `instruction`, `platform` (`android` or `ios`), `limits.seconds`, `limits.steps` and at least one check are required.
- `start` sets the state before the agent begins: `seed_cart`, `device` settings (for example the next payment result) and `network`.

### Check types

| Type | Passes when |
| --- | --- |
| `order_exists` | An order in the session has every listed item (by `id` or `name`, with `quantity`). Add `count` to require an exact number of orders. |
| `screen_shown` / `text_present` | The text is on the final screen. |
| `text_absent` | The text is not on the final screen. |
| `text_seen` | The text appeared at some step, even if the screen changed later. |
| `no_crash` | No step reported a crash. |

## How it is scored

- **Steps**: tool calls the agent made, not counting `end_session`.
- **Errors**: steps that returned an error. **Retries**: the same call repeated right after it failed.
- **Findings**: each error code, with the tool and how many times it happened.
- **Ended by**: `agent`, `step_limit` or `time_limit`. At a limit, Shipvo reads the final screen and the orders itself.

## Troubleshooting

- **`no task "x": expected tasks/x.task.json`**: run the command from the folder that has `tasks/`, or pass the file path.
- **`open_app failed at the start of the run`**: the MCP server is not reachable or the app name is wrong. Check `--mcp` and `--key`.
- **The run ends with `step_limit` right away**: raise `limits.steps`, or check that the agent is not repeating a failing call (see Retries).
- **The agent's calls are not counted**: use the session name Shipvo printed in every tool call. Calls for another session are not scored.
- **HTTP 410 from the proxy**: the run is over. Start a new run.

## Next steps

- [Test with an assistant](test-with-an-assistant.md) and [agents](agents.md): how an agent drives the phone.
- [Typed tests](testing.md): keep what an agent finds as a test you run in CI.
- [Record demo videos](record.md): record an eval run.
