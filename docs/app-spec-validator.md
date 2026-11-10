# App spec validator

This page is for developers and assistants that write Shipvo app specs (`shipvo.app/v0`) and want to check them before a phone opens them. You will validate a spec, read the errors and fix them.

`@shipvo/spec` holds the JSON Schema and `validate(spec)`. It never throws: errors refuse the spec, warnings are shown but do not. The format is in [the app spec design](design/app-spec.md). The full list of checks and the rest of the API are in the [@shipvo/spec README](../packages/spec/README.md).

## Check a spec

1. Install the package: `npm install @shipvo/spec`.
2. Call `validate` on the spec.

```js
import { validate } from "@shipvo/spec";

const { errors, warnings } = validate({
  spec: "shipvo.app/v0",
  app: { id: "hello", name: "Hello" },
  permissions: { network: ["api.example.com"] },
  data: { rates: { source: "http", get: "https://other.example.com/rates" } },
  screens: [{ id: "home", body: [{ type: "text", value: "Hi" }] }]
});
console.log(errors);
```

Output, from running this on this branch:

```json
[
  {
    "path": "$.data.rates.get",
    "message": "\"other.example.com\" is not declared in permissions.network.",
    "fix": "Add \"other.example.com\" to permissions.network."
  }
]
```

Each issue has a `path` (a JSON path to the exact place), a `message` and a `fix` you can apply as written. A spec with no problems returns `{ "errors": [], "warnings": [] }`.

## Network and write permissions

`permissions.network` lists the domains the app reads from (`data` sources). `permissions.write` lists the domains action steps may call. They are separate so that reading a service never grants writing to it, and each write needs approval.

The schema file ships as `@shipvo/spec/schema.json`. Give it to an assistant, or put it in an MCP tool description, so specs come out valid the first time.

## Troubleshooting

- **`is not declared in permissions.network`**: the `data` source calls a domain the spec does not list. Add the domain to `permissions.network`, or point the source at a listed one. For an action step that changes data, use `permissions.write`.
- **`Interactive block "button" has no label`**: add a short `label`. People and assistants find the block by that name.
- **`Missing required "get"` or `Unknown key`**: an HTTP source uses `source: "http"` with a `get` URL. Remove keys the error names and add the ones it asks for.
- **A string is refused as a possible key**: the spec never holds a secret value. Declare the key by name under `secrets` and save its value on the phone.

## Next steps

- [Spec blocks](spec-blocks.md): every block, with examples.
- [Describe an app](describe-an-app.md): an assistant writes the spec and validates it for you.
- [Glossary](glossary.md): app spec, block and saved key in plain words.
