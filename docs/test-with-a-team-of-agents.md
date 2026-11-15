# Test with a team of agents

A lead agent opens one room, starts one sub-agent for an Android session and one for an iOS session, and reads what they did. This page walks through it with tool calls that use the parameters from the tool schemas.

This page is for developers who use Claude Code with sub-agents. The walk-through targets the hosted server, `https://sim.shipvo.dev/mcp`, where `platform` picks the Android or iOS phone skin ([Agents and MCP](agents.md)). Every tool and parameter below is defined in [`packages/mcp-tools/src/index.ts`](../packages/mcp-tools/src/index.ts) and the [tool registry](mcp-tools.md). That file is also where the parameter rules are, such as the room name format and the note length.

## The plan

| Who | Does |
| --- | --- |
| Lead | Picks the room name, starts the sub-agents, polls `room_log`, collects `room_report` |
| Sub-agent A | Opens an Android session in the room, tests, posts notes with `room_note` |
| Sub-agent B | Opens an iOS session in the room, tests, posts notes with `room_note` |

Both sessions share one backend because they use the same `room`.

## Steps

1. **Lead: pick a room name.** For example `checkout-team`. Give it to both sub-agents in their instructions, along with the app id and which platform each one tests.

2. **Sub-agent A (Android): open a session.**

   ```text
   open_app(app: "tide-and-tackle@latest", room: "checkout-team", platform: "android", attach: "never")
   ```

   The result starts with `session: <id>`. Use that id in every later call. `attach: "never"` keeps the session from attaching to a phone another agent is using.

3. **Sub-agent B (iOS): open a session in the same room**, the same way with the iOS skin.

   ```text
   open_app(app: "tide-and-tackle@latest", room: "checkout-team", platform: "ios", attach: "never")
   ```

4. **Sub-agents: test, and post a note for each finding.** A sub-agent acts with `screen`, `tap`, `type`, `scroll` and `back`, and leaves a note for the others with `room_note`:

   ```text
   room_note(room: "checkout-team", text: "Android: checkout fails when the cart has 3 items")
   ```

   The reply is `noted, cursor: <n>`. A note is plain text, 1 to 500 characters. A longer note returns `note_too_long`. The note is tagged with the name your MCP client reports.

5. **Lead: poll the log.** `room_log` is read-only, so the lead can call it as often as it likes. The first call returns everything:

   ```text
   room_log(room: "checkout-team")
   ```

   Each line is an action (time, session, agent, tool, target, change on screen) or a note. The last line is `cursor: <n>`. Pass it back as `since` to get only what is new:

   ```text
   room_log(room: "checkout-team", since: "<cursor from the last call>")
   ```

   With nothing new the reply is `no new entries` and the same cursor.

6. **Lead: collect the report.** When the sub-agents finish, one call gives one line per session:

   ```text
   room_report(room: "checkout-team")
   ```

   Each line has the session, the agent name, the steps taken, the seconds the session spent, the number of errors and the notes that session's agent posted. For example:

   ```text
   s1 (reviewer-a): 14 steps in 62s, 0 errors, notes: Android: checkout fails when the cart has 3 items
   ```

   A note is listed under a session only when its agent name opened exactly one session in the room. Claude Code sub-agents usually share the parent's MCP connection, so they share one client name, for example `claude-code`. With a shared name, no note appears in `room_report`. Every note is still in `room_log`.

   To keep the notes attributable, start each note with the platform and session id, for example `Android s1: checkout fails when the cart has 3 items`, and have the lead read the notes from `room_log`.

   The structured result is `{ room, sessions }`, one object per session with `session`, `agent`, `steps`, `seconds`, `errors`, `last_screen_title` and `notes`. `last_screen_title` is set only when the simulator supplies a title for an action, so it is often null.

7. **Everyone: end the session.** Each sub-agent calls `end_session(session: "<id>")`. Call `room_report` before the last session ends.

## If something goes wrong

| Code | Meaning |
| --- | --- |
| `no_room` | No open session is in that room. Open a session with `room` first, or check the spelling |
| `note_too_long` | The note is over 500 characters |

`room_log` and `room_note` list more codes, such as `bad_cursor`. They are in the [tool registry](mcp-tools.md).

## What the tests cover

- `room_log` with `since`, `room_note` and `note_too_long`: [`packages/mcp/test/rooms.test.ts`](../packages/mcp/test/rooms.test.ts), "room_log and room_note pass through".
- Two sessions in one room, shown by `list_sessions`: same file, "open_app passes room".
- `room_report`: one summary per session, with steps, seconds, errors and notes, and `no_room` for an unknown room: same file, "room_report gives one summary per session", and [`room-report.test.ts`](../packages/mcp/test/room-report.test.ts). The last test there covers notes sent to a single session and notes dropped when an agent name has several.

These tests use a fake simulator. They check each tool's parameters and results, not the whole lead and sub-agent flow.

## Next steps

- [Agents and MCP](agents.md): rooms, the room log and every tool.
- [Test with an assistant](test-with-an-assistant.md): one assistant testing your app.
- [The MCP tool registry](mcp-tools.md): the schema of every tool.
