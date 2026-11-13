# @shipvo/mcp-tools

The registry of every Shipvo MCP tool: name, description, input schema, hints, error codes and whether the tool needs an approval card. The local server (`@shipvo/mcp`) and the hosted Shipvo simulator build their tool lists from it, so both show the same tools.

Use it to read the tool list without starting a server: to generate docs, to check an agent's tool calls against the schemas, or to build your own MCP server on the same definitions.

## Install

```bash
npm install @shipvo/mcp-tools
```

## Example

```js
import { tools, describeTools } from "@shipvo/mcp-tools";

console.log(tools.tap.name);                    // "tap"
console.log(tools.owner_command.needsApproval); // true

// Every tool as plain JSON, with its input as JSON Schema.
for (const t of describeTools()) console.log(t.name, Object.keys(t.inputSchema.properties ?? {}));

// Check an input before you send it. `input` is a Zod shape, so this needs `zod` in your project.
import { z } from "zod";
const checked = z.object(tools.open_app.input).safeParse({ app: "myshop", model: "iPhone 16 Pro" });
console.log(checked.success); // true
```

## API

| Export | What it is |
| --- | --- |
| `tools` | An object of every tool by name. Each entry has `name`, `description`, `input` (a Zod shape), `annotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`), `errorCodes` and `needsApproval`. |
| `toolList` | The same definitions as a list. |
| `describeTools()` | The list as plain JSON: `{ name, description, inputSchema, annotations, errorCodes, needsApproval }`, with `inputSchema` as JSON Schema. |
| `ToolDef`, `ToolInfo` | The TypeScript types of a definition and of a `describeTools()` entry. |
| `inputHasKey(input)` | `true` when any string in a tool input looks like an API key, a private key or a token. |
| `containsKeyShapedText(text)` | The same check for one string. |
| `KEY_REFUSAL`, `KEY_IN_INPUT` | The message and the error code the servers answer with when an input holds a key. |
| `wantsMatch(wait)` | `true` when a `wait_for` input names something to wait for. |

Error codes are lowercase words joined by underscores, for example `bad_model` or `not_agent_ui`.

## Adding a tool

Add its definition to `src/index.ts`, then register its handler with `use(server, tools.<name>, handler)` in `packages/mcp/src/server.ts`. `packages/mcp/test/registry-parity.test.ts` starts both servers and fails if their tool lists differ from each other or from the registry.
