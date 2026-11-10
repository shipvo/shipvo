# Test with a team of agents

One lead agent can run several sub-agents, each driving its own phone, all in one room. The phones share one backend, so an order placed by the buyer shows up for the shop owner. The lead reads progress from the room log and collects results with one call. This works the same on Android and iOS.

## The tools

| Tool | What it does |
|---|---|
| `open_app(app, session, room)` | Each sub-agent opens its own session in the same room |
| `room_log(room, since?)` | Everything done in the room, oldest first. Each entry has a number, time, session, agent name, tool, target and the change line (`new screen`, `content changed`). The result ends with a `cursor`; pass it as `since` next time to read only what is new |
| `room_note(room, text, session?)` | A short note, up to 500 characters, for example `Buyer: order placed, id 42`. A note that starts with `Finding` counts as a finding in the report |
| `room_report(room)` | One summary per session: steps, seconds, errors, findings, last screen and its notes. It also lists the orders in the room |

Only sessions opened with that room appear. A session in another room, or in none, is not in the log or the report.

## Worked example in Claude Code

Add the Shipvo MCP server once, so the lead and its sub-agents use the same server:

```bash
claude mcp add shipvo -- npx @shipvo/mcp
```

Ask the lead agent:

```text
Test checkout in tide-and-tackle with two sub-agents in room "checkout-1".
Sub-agent "buyer": open_app("tide-and-tackle@latest", session: "buyer", room: "checkout-1", platform: "android"),
add a canvas tote to the cart and place an order. When done, room_note "Buyer: order placed, id <id>".
Sub-agent "owner": open_app("tide-and-tackle@latest", session: "owner", room: "checkout-1", platform: "ios"),
wait for the buyer's note in room_log, then check the order is listed. Post a room_note starting with "Finding" for anything wrong.
While they work, poll room_log("checkout-1", since: <cursor>). When both are done, call room_report("checkout-1") and summarise.
```

The lead starts both sub-agents with the Task tool, one per session. Each sub-agent gets its session name and the room in its prompt. A poll by the lead looks like this:

```text
#1 2026-11-10T09:00:01.120Z buyer (claude-code) open_app tide-and-tackle -> new screen
#2 2026-11-10T09:00:02.480Z owner (claude-code) open_app tide-and-tackle -> new screen
#3 2026-11-10T09:00:05.900Z buyer (claude-code) tap button "Add to cart" [e12] -> content changed
#4 2026-11-10T09:00:21.300Z buyer (claude-code) room_note: Buyer: order placed, id 42
cursor: 4
```

The next poll, `room_log("checkout-1", since: 4)`, returns only entries after #4. The report then has one block per session (`buyer`, `owner`), each with its steps, errors, findings, last screen and notes.

`room_log` and `room_report` work after a session has ended.
