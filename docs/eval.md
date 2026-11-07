# Score an agent with `shipvo eval`

This page is for you if you want to know how well an AI agent (or a model) does a job in your app, and you want a number you can compare between agents. You will write a task file, run an agent on it on Android or iOS, and get a score that Shipvo measures from what the app really did, not from what the agent says it did.

## How it works

`shipvo eval run` opens a phone session on the simulator, then starts a small MCP address that sits in front of the Shipvo MCP server. You give that address and the task text to any agent. Every tool call the agent makes passes through and is recorded. Shipvo never calls a model itself, so it works with any agent that speaks MCP.

The run ends when the agent calls `end_session`, when it reaches the step limit, or when time runs out. Then Shipvo checks the result against the task.

## What you need

- A Shipvo project and the simulator MCP server running. The default address is `http://localhost:8787/mcp`. Use `--mcp <url>` (or `SHIPVO_EVAL_MCP`) for another one, and `--key <key>` (or `SHIPVO_EVAL_KEY`) if it needs an API key.
- A task file in `tasks/`. Two samples for the shop template ship in the repository: `tasks/buy-canvas-tote.task.json` and `tasks/declined-card-then-pay.task.json`.

## Write a task

A task is a JSON file named `tasks/<name>.task.json`:

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
| `name`, `app`, `instruction` | Required. `instruction` is the text you give the agent. |
| `platform` | Required: `android` or `ios`. |
| `start` | Optional. `seed_cart` fills the cart, `device` and `network` set the simulated phone (same fields as `set_device`). |
| `limits` | Required: `seconds` and `steps`, both above zero. |
| `checks` | Required, at least one. |

Check types:

| Type | Passes when |
| --- | --- |
| `order_exists` | An order the app sent to its backend has every listed item (`id` or `name`, optional `quantity`). Add `count` to require exactly that many orders. |
| `screen_shown`, `text_present` | The text is on the last screen the agent saw (ignores case). |
| `text_absent` | The text is not on the last screen. |
| `text_seen` | The text appeared on any step. |
| `no_crash` | No step reports a crash. |

## Run an agent

1. Run:

   ```bash
   shipvo eval run buy-canvas-tote --agent my-agent --model my-model
   ```

2. Shipvo prints the address to give your agent:

   ```text
   Eval run ready.
   MCP URL for the agent: http://127.0.0.1:54321/mcp
   Session: eval-buy-canvas-tote-my-agent-20261107120000

   Give the agent this instruction:
   Open the shop. Buy one Canvas tote and pay for it. Call end_session when the order is placed.
   ```

   The port and session name here are an example. Yours differ. Use `--port` to pick a port.
3. Point your agent's MCP config at that address and give it the instruction. It must use the printed session name in every tool call.
4. When the run ends, Shipvo prints the result and exits with code 0 if every check passed and 1 if not:

   ```text
   PASS buy-canvas-tote (my-agent) ended by agent: 12 steps, 48s, 0 errors, 0 retries
     ok   order: 1 matching order(s)
     ok   confirmation: "Order placed" on the final screen
   ```

Each run is saved in `.shipvo/eval/<run id>/` (change it with `--dir`) as `run.json` and `steps.jsonl`, one line per tool call. If the agent used `record_start` and `record_stop`, the result also links the recording.

What is measured: pass or fail for each check, steps, seconds, errors, retries (the same failing call repeated with the same arguments), and findings (error codes counted per tool). Add `--json` for the usual `{ ok, code, summary, data, next }` envelope.

## Compare runs

Run each agent several times, then:

```bash
shipvo eval report --out eval.md
```

This groups runs by agent, model and task and prints a table with the pass rate, the median steps, the median seconds and a link to each run's steps and recording. `--out eval.md` also writes `eval.json` next to it. Without runs it prints an empty table.

## Troubleshooting

**`no task "x": expected tasks/x.task.json`.** The name does not match a file. Pass the name without `.task.json`, or a path to the file.

**`open_app failed at the start of the run`.** Shipvo could not open the app on the MCP server. Check that the server is running at the address you gave and that `app` in the task is an app it can open (`list_apps`).

**The run ends by `step_limit` or `time_limit`.** The agent did not call `end_session` in time. Shipvo reads the last screen and the orders itself and scores what happened. Raise `limits` if the task needs more.

**Calls from the agent return 410.** The run is over. Start a new `shipvo eval run`.

## Next steps

- [Agents and Shipvo apps](agents.md): every tool the agent can use.
- [Test your app in CI](testing.md): turn a good run into a test.
- [Record a demo video](record.md): keep a recording of each run.
