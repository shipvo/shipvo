# Score an agent on app tasks (`shipvo eval`)

This page is for anyone who wants to know which AI agent or model does real work on their app best. You write a task in a small file. Any agent does it on a Shipvo phone, on Android or iOS. Shipvo then scores the run itself: it does not rely on what the agent says it did. You get a table you can compare across agents and models.

Shipvo never calls a model for you. You run the agent. Shipvo opens the session, records every step and checks the result.

## Run your first task

You need `@shipvo/cli`, an MCP server for the app, and any agent that can connect to an MCP URL. The repository ships two sample tasks on the shop template in `tasks/`.

1. Start the MCP server over HTTP in a second terminal:

   ```bash
   npx @shipvo/mcp --http 8787
   ```

2. Start the run. `--agent` is a label for the report; use any name.

   ```bash
   npx shipvo eval run buy-canvas-tote --agent claude --model my-model
   ```

3. Shipvo prints an MCP URL, a session name and the instruction:

   ```
   Eval run ready.
   MCP URL for the agent: http://127.0.0.1:<port>/mcp
   Session: eval-buy-canvas-tote-claude-<time>

   Give the agent this instruction:
   Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
   ```

4. Point your agent at that MCP URL, give it the instruction, and tell it to use that session name in every tool call.
5. The run ends when the agent calls `end_session`, when it reaches the step limit, or when time runs out. Shipvo then prints the score:

   ```
   PASS buy-canvas-tote (claude) ended by agent: 9 steps, 41s, 0 errors, 0 retries
     ok   order: 1 matching order(s)
     ok   confirmation: "Order placed" on the final screen
     ok   no-crash: no crash
   Steps: .shipvo/eval/<run id>/steps.jsonl
   ```

   The exit code is 0 when every check passed and 1 when one failed, so you can use it in a script. (The numbers above show the layout. Your steps and seconds will differ.)

## Compare runs

Run the same task with different agents or models, several times each. Then:

```bash
npx shipvo eval report
```

You get a Markdown table with one row per agent, model and task: runs, pass rate, median steps, median seconds, and a link to each run's steps (and recording, if the agent recorded one with `record_start` and `record_stop`).

```
| Agent | Model | Task | Runs | Pass rate | Median steps | Median seconds | Runs (steps, recording) |
```

Add `--out report.md` to save the table. A `report.json` with the same rows is written next to it. Add `--json` for the JSON on screen.

## Write your own task

A task is `tasks/<name>.task.json`. Run it with `shipvo eval run <name>` or with a path to the file.

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
| `name`, `app`, `instruction` | Required. The app is opened with `open_app`. The instruction is the text you give the agent. |
| `platform` | Required. `android` or `ios`. |
| `start.seed_cart` | Optional. Items in the cart before the agent starts. |
| `start.device`, `start.network` | Optional. Device settings applied with `set_device` before the agent starts, such as the next payment result or an offline phone. See [Device API](device-api.md). |
| `limits.seconds`, `limits.steps` | Required, positive numbers. The run stops at whichever comes first. |
| `checks` | Required, at least one. Shipvo evaluates them after the run. |

### Checks

| Type | Passes when |
| --- | --- |
| `order_exists` | An order has every listed item (`id` or `name`, optional `quantity`). With `count`, the number of orders must match exactly. |
| `screen_shown` or `text_present` | `text` is on the last screen the agent saw (not case sensitive). |
| `text_absent` | `text` is not on the last screen. |
| `text_seen` | `text` appeared in any step of the run. Use it for messages that disappear, such as a declined payment. |
| `no_crash` | No step reported a crash. |

Each check can have an `id`; without one it is named by type and position.

## What is measured

Every run writes `run.json` and `steps.jsonl` under `.shipvo/eval/<run id>/` (change the folder with `--dir`).

- **Success per check**, and `pass` when all checks pass.
- **Steps**: tool calls the agent made, not counting `end_session`.
- **Seconds**: from the first tool call to the end.
- **Errors**: steps that returned an error.
- **Retries**: the same failing call repeated with the same arguments.
- **Findings**: error codes grouped by tool, with counts.
- **Ended by**: `agent`, `step_limit` or `time_limit`.

When a limit ends the run, Shipvo reads the final screen and the orders itself and closes the session, so the checks still run.

## Options

| Command | Option | Meaning |
| --- | --- | --- |
| `eval run <task>` | `--agent <name>` | Required. Label for the report. |
| | `--model <name>` | Model label for the report. |
| | `--mcp <url>` | MCP server to use. Default `http://localhost:8787/mcp`, or `SHIPVO_EVAL_MCP`. |
| | `--key <key>` | API key for that server, or `SHIPVO_EVAL_KEY`. |
| | `--port <n>` | Port for the URL you give the agent. Default: a free port. |
| | `--dir <path>` | Where runs are saved. Default `.shipvo/eval`. |
| | `--json` | Print the result as JSON. |
| `eval report` | `--dir`, `--json`, `--out <file>` | As above. |

## Troubleshooting

- **`no task "x": expected tasks/x.task.json`**: run the command from the folder that has `tasks/`, or pass the path to the file.
- **`open_app failed at the start of the run`**: Shipvo could not open the app, for example because it could not reach the MCP server. Start it with `npx @shipvo/mcp --http 8787`, or set `--mcp` and `--key`.
- **The agent gets `the eval run is over`**: the run already ended (a limit, or `end_session`). Start a new run.
- **Steps from the agent are not counted**: the agent used a different session name. Calls with another `session` are ignored. Tell the agent to use the printed session in every call.
- **The run ended by `time_limit` or `step_limit`**: raise the limits in the task file, or check the steps file for a loop.
- **The report is empty**: no `run.json` files in `.shipvo/eval`. Use the same `--dir` for `run` and `report`.

## Next steps

- [Agent testing over MCP](agents.md): the tools an agent uses in a run.
- [Device API](device-api.md): payment, network and other device settings for `start.device`.
- [Record demo videos](record.md): let the agent record a run so the report links to it.
- [Command reference](cli.md).
