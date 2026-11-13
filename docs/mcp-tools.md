# The MCP tool registry (`@shipvo/mcp-tools`)

This page is for developers who build on the Shipvo MCP tools: to generate docs, to check an agent's tool calls, or to write an MCP server on the same definitions. You need Node 20 or newer.

`@shipvo/mcp-tools` holds every Shipvo MCP tool as data: name, description, input schema, hints, error codes and whether the tool needs an approval card. The local server (`@shipvo/mcp`) and the hosted Shipvo simulator build their tool lists from it.

## Steps

1. Install the package:

   ```bash
   npm install @shipvo/mcp-tools
   ```

2. Read the tools:

   ```js
   import { tools, describeTools } from "@shipvo/mcp-tools";

   console.log(tools.tap.name);                    // "tap"
   console.log(tools.owner_command.needsApproval); // true
   for (const t of describeTools()) console.log(t.name, t.errorCodes.join(", "));
   ```

   `describeTools()` returns plain JSON. Each entry has `name`, `description`, `inputSchema` (JSON Schema), `annotations`, `errorCodes` and `needsApproval`.

3. Check a tool input against its schema with any JSON Schema validator, using `inputSchema` from step 2.

## What it exports

| Export | What it is |
| --- | --- |
| `tools` | Every tool by name, with its input as a Zod shape. |
| `toolList` | The same definitions as a list. |
| `describeTools()` | The list as plain JSON, with inputs as JSON Schema. |
| `inputHasKey(input)`, `containsKeyShapedText(text)` | Checks for an API key, private key or token in a tool input. The servers refuse such inputs with the code `key_in_input`. |

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `ERR_REQUIRE_ESM` | The package is ES modules only. Use `import`, or `await import("@shipvo/mcp-tools")` from CommonJS. |
| A tool your agent sees is missing from `tools` | Update `@shipvo/mcp-tools` to the version released with your `@shipvo/mcp`. |

## Next steps

- [Agents and MCP](agents.md): connect an agent to the tools.
- [Test with a team of agents](test-with-a-team-of-agents.md): the `open_app`, `room_note`, `room_log` and `room_report` tools in one worked example.
- [A2UI on Shipvo Phone](a2ui.md): the `a2ui_open`, `a2ui_send` and `a2ui_actions` tools.
