# Test with a team of agents

A lead agent opens one room, starts one sub-agent for an Android session and one for an iOS session, and reads what they did. This page walks through it with the real tool calls.

This page is for developers who use Claude Code with sub-agents. You need the Shipvo MCP server connected ([Agents and MCP](agents.md)). Every tool and parameter below is defined in [`packages/mcp/src/server.ts`](../packages/mcp/src/server.ts) and the [tool registry](mcp-tools.md).

## The plan

| Who | Does |
| --- | --- |
| Lead | Picks the room name, starts the sub-agents, polls `room_log`, collects `room_report` |
| Sub-agent A | Opens an Android session in the room, tests, posts notes with `room_note` |
| Sub-agent B | Opens an iOS session in the room, tests, posts notes with `room_note` |

Both sessions share one backend because they use the same `room`. An order placed on one phone shows up on the other.

## Steps

1. **Lead: pick a room name.** Use 1 to 64 letters, digits, `_` or `-`, for example `checkout-team`. Give it to both sub-agents in their instructions, along with the app id and which platform each one tests.

2. **Sub-agent A (Android): open a session.**

   ```text
   open_app(app: "tide-and-tackle@latest", room: "checkout-team", platform: "android", attach: "never")
   ```

   The result starts with `session: <id>`. Use that id in every later call. `attach: "never"` keeps the session headless, so it never attaches to a phone another agent is using.

3. **Sub-agent B (iOS): open a session in the same room.**

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

   Each line has the session, the agent name, the steps taken, the seconds the session spent, the number of errors, the title of the last screen and the notes that session's agent posted. For example:

   ```text
   s1 (claude-code): 14 steps in 62s, 0 errors, screen "Cart", notes: Android: checkout fails when the cart has 3 items
   ```

   A note is listed under the session its agent opened, matched by the agent name that `room_log` shows. Give each sub-agent its own MCP client name so its notes land on its own session; `room_log` always shows every note.

   The structured result is `{ room, sessions }`, one object per session with `session`, `agent`, `steps`, `seconds`, `errors`, `last_screen_title` and `notes`.

7. **Everyone: end the session.** Each sub-agent calls `end_session(session: "<id>")`. The room, and its log, end with its last session. Call `room_report` before then.

## If something goes wrong

| Code | Meaning |
| --- | --- |
| `no_room` | No open session is in that room. Open a session with `room` first, or check the spelling. Also returned once the last session has ended |
| `bad_room` | The room name is not valid. Use 1 to 64 letters, digits, `_` or `-` |
| `bad_cursor` | `since` is not a cursor from an earlier read. Leave `since` out to read from the start |
| `note_too_long` | The note is over 500 characters |

## What the tests cover

- `room_log` with `since`, `room_note` and `note_too_long`: [`packages/mcp/test/rooms.test.ts`](../packages/mcp/test/rooms.test.ts), "room_log and room_note pass through".
- Two sessions in one room, shown by `list_sessions`: same file, "open_app passes room".
- `room_report`: one summary per session, with steps, seconds, errors and notes, and `no_room` for an unknown room: same file, "room_report gives one summary per session", and [`room-report.test.ts`](../packages/mcp/test/room-report.test.ts).

## Next steps

- [Agents and MCP](agents.md): rooms, the room log and every tool.
- [Test with an assistant](test-with-an-assistant.md): one assistant testing your app.
- [The MCP tool registry](mcp-tools.md): the schema of every tool.
