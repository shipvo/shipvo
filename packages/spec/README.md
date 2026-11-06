# @shipvo/spec

The Shipvo app spec, `shipvo.app/v0`: a JSON Schema and a validator. Design: `docs/design/app-spec.md`.

## Install

```bash
npm install @shipvo/spec
```

## Example

```ts
import { validate } from "@shipvo/spec";

const { errors, warnings } = validate({
  spec: "shipvo.app/v0",
  app: { id: "hello", name: "Hello" },
  screens: [{ id: "home", body: [{ type: "button" }] }]
});
// errors[0] = {
//   path: "$.screens[0].body[0]",
//   message: 'Interactive block "button" has no label.',
//   fix: 'Add "label": a short name that people and agents see, for example "Add goal".'
// }
```

`validate` never throws. Errors refuse the spec; warnings are shown but do not.

## API

- `validate(spec: unknown): { errors: Issue[]; warnings: Issue[] }`. An `Issue` is `{ path, message, fix }`, where `path` is a JSON path such as `$.screens[0].body[1]`.
- `appSpecSchema`: the JSON Schema as an object.
- `@shipvo/spec/schema.json`: the same schema as a file, to give to assistants or put in MCP tool descriptions.
- `celSyntaxError(source)`: syntax check for one CEL expression.
- `contrastRatio(a, b)`: WCAG contrast ratio of two hex colours.

## What it checks

Errors: schema violations; HTTP to domains not in `permissions.network` (or `permissions.write` for action steps); strings that look like keys or tokens; interactive blocks without `label`; palette text contrast under 4.5:1; invalid CEL syntax or an expression over 2,000 characters; more than 40 screens or 2,000 blocks.

Warnings: touch targets under 44 px, more than three type sizes on a screen, many different spacing values on a screen, lists without an empty state, charts without a label, actions without a description.

CEL expressions are only syntax-checked. Name and type checks come later.
