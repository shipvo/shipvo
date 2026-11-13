# A2UI on Shipvo Phone

This page is for developers and coding agents that build screens with [A2UI](https://a2ui.org/), the open protocol where an agent describes a screen as data. You will open A2UI messages on a simulated Android phone or iPhone, use the screen, read what it sends back to the agent, and change it while it is open.

Shipvo Phone reads A2UI version 1.0 messages and draws every component of the A2UI basic catalog. The agent sends data, never code.

## What you need

- Node 22.
- A file of A2UI messages: one JSON message per line, or one JSON list. You do not need an app folder.

## Open a screen

1. Save your messages as `booking.jsonl`. Each line is one message, for example a `createSurface` with its components and data model.
2. Run:

   ```bash
   npx -y @shipvo/cli session start --a2ui booking.jsonl --device "iPhone 16 Pro" --json
   ```

   Leave `--device` out for a Pixel 8. `shipvo session devices` lists the phones.
3. `data.screen` is the screen as a tree. Every control has a role, a name and a ref:

   ```text
   - tab "Flights" [selected] [ref=e14]
   - button "Select" [ref=e24]
   - textbox "Email" [ref=e217]
   - checkbox "I accept the fare rules" [ref=e231]
   - button "Confirm booking" [disabled] [ref=e42]
   - alert [ref=e44]: Accept the fare rules to continue
   ```

A button is named by the text inside it, and a field by its label, so a screen reader and an agent find them the same way.

## Use it, and read what the agent receives

```bash
shipvo session tap e24                       # a button: sends its action to the agent
shipvo session type e217 "hans@example.com"  # writes the value the field is bound to
shipvo session screenshot --out shots/booking.png
shipvo session a2ui actions                  # the messages the screen sent to the agent
```

`a2ui actions` returns A2UI `action` messages, with the context already resolved:

```json
{ "version": "1.0", "action": { "name": "confirm_booking", "surfaceId": "booking", "sourceComponentId": "go",
  "timestamp": "2026-11-13T09:55:41.000Z", "context": { "email": "hans@example.com", "cabin": ["biz"], "bags": 1 } } }
```

A button inside a list sends the values of its own row. `--since <n>` returns the messages after the first `n`; the result's `next` is the number to pass next time.

## Change the screen while it is open

```bash
shipvo session a2ui send update.jsonl
```

Each message changes one piece. `updateDataModel` writes one value at a path, and `null` removes it. `updateComponents` replaces the components it names and leaves the others. `createSurface` adds a surface and `deleteSurface` removes one. The result has the number of messages applied, the ones refused with their A2UI error, and the new screen.

A message that is not valid is refused and changes nothing. The error says where: for example `VALIDATION_FAILED` at `/components/0/component` for a component that is not in the catalog.

## Components

| Catalog | Components |
| --- | --- |
| A2UI basic catalog | Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput |
| Shipvo Phone catalog | Stat, Badge, Progress |

Values can be literals, bindings (`{"@path": "/trip/email"}`) and function calls (`{"@call": "formatCurrency", "args": {...}}`). A list can repeat one component for each item of a list in the data model; a binding without a leading slash reads from that item. `@checks` show their message when a condition fails, and a button with a failing check is disabled.

The Shipvo Phone catalog is an A2UI catalog document. Use its components with `"@catalogId": "https://shipvo.dev/a2ui/catalogs/phone/v1/catalog.json"` on the component. A running simulator serves the document at `/a2ui/catalog.json`.

## Functions that need a tap

`openUrl` runs only when a person taps a button. It does not run from a binding, and it does not run when the agent asks for it with `callRendererFunction`: the agent gets `INVALID_FUNCTION_CALL`. A tap records the address under `effects` in `a2ui actions`. Functions that need no tap, such as `email` or `numeric`, answer the agent with their value.

## Over the simulator's HTTP API

`POST /session` with `"a2ui": true` opens an A2UI session; `a2ui_messages` (a list, or JSON lines as text) are applied before the page opens. `POST /act` with `"action": "a2ui_send"` takes `messages` or `jsonl`, and `"action": "a2ui_actions"` takes an optional `since`. The engine is `@shipvo/sim/a2ui.mjs`: `createA2ui()` returns `apply`, `applyAll`, `html`, `op` and `take`.

## Troubleshooting

| Code | Meaning | What to do |
| --- | --- | --- |
| `no_file` | The A2UI file is missing or empty. | Check the path. |
| `bad_message` | The file starts like a JSON list but is not valid JSON. | Fix the file, or use one message per line. |
| `a2ui_errors` | `a2ui send` refused one or more messages. | Read `data.errors`: each has a code, a message and a path. |
| `not_a2ui` | The session was not started with `--a2ui`. | Start one with `shipvo session start --a2ui <file>`. |
| The screen says "No surface yet." | No `createSurface` has been applied. | Send one, with a component whose id is `root`. |

## Next steps

- [Test any Expo app from the terminal](session.md)
- [Agents and MCP tools](agents.md)
- [Bug-catch benchmark](bug-bench.md)
