# Score an agent on an app task

This page is for developers who want to know how well a coding agent or an assistant can use their app. You write a task, run an agent against the Shipvo simulator, and get a pass or fail from what the app really did, with steps, time, errors and retries.

`shipvo eval` never calls a model. It opens a session, puts a recording proxy in front of the MCP server, and prints a URL. You connect any agent to that URL, on Android or iOS, and the run is scored when the agent calls `end_session`.

## Run a task

1. Start an MCP server that can open your app. For the shop template, run the local server from the app folder (default `http://localhost:8787/mcp`), or use the hosted phone with `--mcp` and `--key` ([Agents](agents.md)).
2. Start the run:

   ```bash
   npx shipvo eval run buy-canvas-tote --agent claude-code --model my-model
   ```

3. The command prints the proxy URL, the session id and the instruction:

   ```text
   Eval run ready.
   MCP URL for the agent: http://127.0.0.1:<port>/mcp
   Session: eval-buy-canvas-tote-claude-code-<timestamp>

   Give the agent this instruction:
   Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
   ```

4. Point the agent's MCP config at that URL and give it the instruction. It must use the printed session id in every tool call.
5. When the run ends you see the result. The exit code is 0 for a pass and 1 for a fail:

   ```text
   PASS buy-canvas-tote (claude-code) ended by agent: <steps> steps, <n>s, 0 errors, 0 retries
     ok   order: 1 matching order(s)
     ok   confirmation: "Order placed" on the final screen
     ok   no-crash: no crash
   Steps: .shipvo/eval/<run>/steps.jsonl
   ```

A run ends in one of three ways, shown as `ended`: `agent` (it called `end_session`), `step_limit` or `time_limit`. When a limit ends the run, Shipvo reads the final screen and the orders itself and closes the session.

### Options for `shipvo eval run <task>`

| Option | Meaning |
| --- | --- |
| `<task>` | A task name (reads `tasks/<name>.task.json`) or a path to a `.json` file. |
| `--agent <name>` | Required. Label for the agent, used in the report. |
| `--model <name>` | Label for the model, used in the report. |
| `--mcp <url>` | The MCP server to score against. Also `SHIPVO_EVAL_MCP`. Default `http://localhost:8787/mcp`. |
| `--key <key>` | Key sent as a bearer token to that server. Also `SHIPVO_EVAL_KEY`. |
| `--port <n>` | Port for the proxy on `127.0.0.1`. Default: a free port. |
| `--dir <path>` | Where runs are saved. Default `.shipvo/eval`. |
| `--json` | Print the result as JSON. |

Each run writes `run.json` and `steps.jsonl` under `<dir>/<run>/`. `steps.jsonl` has one line per tool call: number, time, tool, arguments, `ok`, error `code` and the text returned.

## Write a task

A task is a JSON file in `tasks/`. The repository has two on the shop template: `buy-canvas-tote` (Android) and `declined-card-then-pay` (iOS).

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
| `name`, `app`, `instruction` | Required. `app` is the app id to open. |
| `platform` | Required: `android` or `ios`. |
| `start.seed_cart` | Items in the cart when the run starts. |
| `start.device`, `start.network` | Device and network settings applied with `set_device` before the agent connects ([Device API](device-api.md)). |
| `limits.seconds`, `limits.steps` | Required positive numbers. |
| `checks` | Required, at least one. All must pass for the run to pass. |

### Checks

| Type | Passes when |
| --- | --- |
| `order_exists` | An order the app posted has every listed item (`id` or `name`, optional `quantity`). With `count`, the number of orders must match exactly. |
| `screen_shown`, `text_present` | The text is on the final screen (not case sensitive). |
| `text_absent` | The text is not on the final screen. |
| `text_seen` | The text appeared in the result of any step. |
| `no_crash` | No step reported a crash. |

`order_exists` reads the orders the app sent to its backend, not what the agent says it did.

## Compare runs

```bash
npx shipvo eval report
npx shipvo eval report --out eval.md
```

The report groups runs by agent, model and task. It shows pass rate, median steps, median seconds, and a link to each run's steps and recording (from `record_stop`, see [Record](record.md)). `--out eval.md` also writes `eval.json` next to it, and `--json` prints the rows as JSON. Use `--dir` to read another folder.

## Troubleshooting

**`no task "<name>": expected tasks/<name>.task.json`.** Run the command from the folder that has `tasks/`, or pass the path to the file.

**`open_app failed at the start of the run`.** The MCP server did not open the app. Check that it is running and that `--mcp` and `--key` are right ([Agents](agents.md)).

**The agent gets `410` from the proxy.** The run is over (it hit a limit or called `end_session`). Start a new run.

**The run passes nothing and shows 0 steps.** The agent did not use the session id from the output. Tool calls for any other session are not counted.

## Next steps

- [Agents and Shipvo apps](agents.md): every MCP tool the agent can use.
- [Test your app in CI](testing.md): turn a good run into a typed test.
- [Record a demo video](record.md): attach a recording to each run.
