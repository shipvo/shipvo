# @shipvo/mcp-tools

Private workspace package (not published). One registry of every Shipvo MCP tool: name, description, input schema, hints, error codes and whether an approval card is needed.

`@shipvo/mcp` (the stdio server and the `--http` remote server) registers its tools from `tools`, so both show the same list. `@shipvo/mcp` bundles this package into `dist/server.js` at build time.

```ts
import { tools, describeTools } from "@shipvo/mcp-tools";

tools.tap.name;          // "tap"
tools.owner_command.needsApproval; // true
describeTools();         // [{ name, description, inputSchema (JSON Schema), annotations, errorCodes, needsApproval }, ...]
```

Handlers stay in `@shipvo/mcp` for now. To add a tool, add its definition here, then register its handler with `use(server, tools.<name>, handler)` in `packages/mcp/src/server.ts`. `packages/mcp/test/registry-parity.test.ts` starts both servers and fails if their tool lists differ from each other or from the registry.
