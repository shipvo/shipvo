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
- `evaluate(expression, scope?, options?)`: runs one CEL expression and returns a plain value. See below.
- `evaluateTemplate(text, scope?, options?)`: fills the `{{ }}` parts of a string. A string that is only one `{{ }}` keeps the value's type.
- `celSyntaxError(source)`: syntax check for one CEL expression.
- `contrastRatio(a, b)`: WCAG contrast ratio of two hex colours.

## Evaluate expressions

```ts
import { evaluate, evaluateTemplate } from "@shipvo/spec";

const scope = { charges: [{ amount: 1200, status: "succeeded" }, { amount: 800, status: "failed" }] };
const options = { locale: "de-DE", now: "2026-11-06T10:30:00Z" };

evaluate("sum(charges.filter(c, c.status == 'succeeded').map(c, c.amount)) / 100", scope, options); // 12
evaluateTemplate("Paid: {{ money(12, 'EUR') }}", scope, options); // "Paid: 12,00 €"
evaluateTemplate("{{ count(charges) }}", scope, options); // 2 (a number, not text)
```

`options`: `locale` (default `en-US`), `timeZone` (default `UTC`), `now` and `maxCost`. Numbers are doubles, as in JSON, so `size(x) + 1` and `a / b - 1` work. `evaluate` throws `ExpressionError` for an expression over 2,000 characters, over the cost limit (nested list macros multiply the cost), or that fails to run.

Functions: `sum avg min max count unique sortBy groupBy first last take`; `today startOf endOf addDays diffDays formatDate unix`; `money number percent compact`; `lower upper trim split join`; `orElse`; and CEL's `filter map exists all has contains startsWith endsWith matches`. Dates are ISO 8601 strings. `startOf`/`endOf` units: `day week month year` (weeks start on Monday). `formatDate` patterns: `day month year time datetime iso`.

## What it checks

Errors: schema violations; HTTP to domains not in `permissions.network` (or `permissions.write` for action steps); strings that look like keys or tokens; interactive blocks without `label`; palette text contrast under 4.5:1; invalid CEL syntax; unknown names, fields (of `data`, `state`, `input`, `person`) and functions, with a "did you mean" suggestion; wrong argument counts for library functions; an expression over 2,000 characters, 400 tokens or the cost limit; more than 40 screens or 2,000 blocks.

Warnings: touch targets under 44 px, more than three type sizes on a screen, many different spacing values on a screen, lists without an empty state, charts without a label, actions without a description.

HTTP URLs must be absolute `https://` with a fixed host; `{{ }}` is allowed only in the path and query.
