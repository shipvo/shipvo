# Shipvo app spec, v0 (draft)

Status: draft for review by the owner, 6 Nov 2026. Nothing here is built yet.

A Shipvo app spec is a JSON document that describes a whole app: its look, its data, its screens, its logic and the actions agents can call. An assistant writes the spec; the Shipvo app engine validates it and renders it as a native-feeling app on Shipvo Phone (and, later, on real phones through the native shell). No AI runs after the spec is written: the same spec always gives the same app.

Two parts, two jobs: the spec's structure (screens, blocks, theme, data, permissions, actions, schedules) is JSON, validated against a JSON Schema; the small formulas inside it, written between `{{ }}` in string values, are CEL expressions (section 7). Example: in `{ "type": "stat", "value": "{{ money(revenueToday, 'EUR') }}" }` the block is JSON and `money(revenueToday, 'EUR')` is CEL.

## 1. Goals and non-goals

Goals:
- Any assistant (ChatGPT, Claude, Gemini) can write a valid spec from a plain request, using the published JSON Schema and examples.
- Apps look distinct and polished, not like one template with a new colour.
- Every app is usable by people and by agents: every control is labelled, and every user action also exists as a typed MCP action.
- Safe by construction: no arbitrary code, network only to declared domains, keys only from the vault by name.
- Small: a typical personal app is under 300 lines of spec.

Non-goals for v0: games, custom native modules, real-time multiplayer, background audio, arbitrary code. These go through the escape hatch (export to a code app).

## 2. Document shape

```json
{
  "spec": "shipvo.app/v0",
  "app": { "id": "stripe-tracker", "name": "Stripe Tracker", "icon": "chart-line", "description": "Daily Stripe revenue, customers and failed payments." },
  "theme": { },
  "permissions": { },
  "secrets": [ ],
  "data": { },
  "state": { },
  "screens": [ ],
  "navigation": { },
  "actions": { },
  "schedules": [ ],
  "strings": { }
}
```

Only `spec`, `app` and `screens` are required. Unknown keys are refused, so typos fail loudly.

## 3. Theme

Tokens, not styles. Components read tokens, so a theme changes the whole app consistently.

```json
"theme": {
  "mode": "dark",
  "palette": { "primary": "#7CF3C8", "accent": "#FF7A59", "background": "#0B0F14", "surface": "#141A22", "text": "#F3F6F9", "muted": "#8A97A8", "danger": "#FF5D6C", "success": "#3DDC97" },
  "font": { "family": "Inter", "display": "Space Grotesk", "scale": 1.0 },
  "radius": "lg",
  "density": "comfortable",
  "elevation": "soft",
  "motion": "lively"
}
```

- `palette` colours are checked for contrast (WCAG AA for text); failures are errors.
- `font.family` and `font.display` come from a bundled list of open-licence fonts.
- `radius`: none, sm, md, lg, xl, full. `density`: compact, comfortable, spacious. `elevation`: flat, soft, raised. `motion`: none, calm, lively.
- `mode`: light, dark or system. If only one palette is given, the engine derives the other mode.

## 4. Permissions, network and secrets

```json
"permissions": {
  "network": ["api.stripe.com"],
  "device": ["notifications"],
  "write": []
},
"secrets": [
  { "name": "STRIPE_KEY", "service": "stripe", "access": "read", "help": "Create a restricted key with read access to Charges and Balance." }
]
```

- Every HTTP source must target a domain in `permissions.network`. Anything else is a validation error.
- `secrets` declares keys by name. Values live only in the vault; the spec never contains a value, and the validator refuses anything that looks like a key.
- `write` lists domains the app may change data on (POST, PUT, DELETE). Each write action also needs the person's approval per call unless they grant standing permission on the phone.
- `device`: notifications, camera, location, contacts, calendar, photos, files. Each is asked once on install.

## 5. Data

Three kinds of data: remote sources, local collections and computed values.

```json
"data": {
  "charges": {
    "source": "http",
    "get": "https://api.stripe.com/v1/charges",
    "query": { "limit": 100, "created[gte]": "{{ unix(startOf('day', now)) }}" },
    "auth": { "secret": "STRIPE_KEY", "type": "bearer" },
    "select": "data",
    "cache": "5m",
    "refresh": 60,
    "paginate": { "type": "cursor", "param": "starting_after", "next": "last(data).id", "until": "!has_more" }
  },
  "goals": {
    "source": "collection",
    "fields": { "title": "text", "target": "number", "due": "date", "done": "bool" },
    "seed": []
  },
  "revenueToday": {
    "source": "computed",
    "value": "{{ sum(charges.filter(c, c.status == 'succeeded').map(c, c.amount)) / 100 }}"
  }
}
```

- `http` sources run on Shipvo's edge, never in the browser, so the vault key is added server-side. Responses are cached per `cache`. `refresh` (seconds, 30 or more) re-runs an `http` source on that interval while the app is installed, skips `cache` (refreshed values are not written to it), and updates the open screen.
- `collection` sources are the app's own local data, stored per person on their phone (synced to their account). Field types: text, number, money, date, datetime, bool, enum, image, file, ref.
- `computed` values use the expression language (section 7) and update when their inputs change.

## 6. State

Screen-independent values the app keeps while running (filters, selected tab, form drafts).

```json
"state": { "period": { "type": "enum", "options": ["day", "week", "month"], "default": "day" } }
```

## 7. Expressions (CEL)

Expressions inside `{{ }}` are [CEL, the Common Expression Language](https://cel.dev) (decided 6 Nov 2026), evaluated with [`@bufbuild/cel`](https://github.com/bufbuild/cel-es). CEL has no loops or recursion, cannot reach the network or anything undeclared, and its evaluation cost is bounded. Every expression is type-checked during validation against the app's data, state and route types, so a wrong field name is an error with a suggestion before anything runs.

- Names in scope: `data.<name>` (or the bare name for data entries), `state.<name>`, `item` (inside list templates), `input` (inside actions), `result` (after a `call` step), `route.params`, `now`, `person` (locale, time zone, language).
- CEL macros for lists: `charges.filter(c, c.status == 'succeeded')`, `charges.map(c, c.amount)`, `charges.exists(c, c.status == 'failed')`, `charges.all(c, c.paid)`.
- Shipvo function library, registered with types so the checker knows them:
  - numbers and lists: `sum(list<num>)`, `avg`, `min`, `max`, `count(list)`, `unique(list, field?)`, `sortBy(list, field, 'asc'|'desc')`, `groupBy(list, field)`, `first`, `last`, `take(list, n)`;
  - dates: `today()`, `startOf(unit, ts)`, `endOf(unit, ts)`, `addDays(ts, n)`, `diffDays(a, b)`, `formatDate(ts, pattern)`, `unix(ts)`;
  - formatting (uses the person's locale): `money(amount, currency)`, `number(x, decimals?)`, `percent(x)`, `compact(x)`;
  - text: `lower`, `upper`, `trim`, `split`, `join`, plus CEL's built-in `contains`, `startsWith`, `matches`;
  - fallbacks: `orElse(value, fallback)`, or CEL's `has(x.field) ? x.field : fallback`.
- Limits: 2,000 characters per expression and a cost limit per evaluation (CEL cost estimation); over-limit expressions are validation errors.

## 8. Screens and navigation

```json
"navigation": { "type": "tabs", "items": [ { "screen": "today", "icon": "sun" }, { "screen": "trends", "icon": "chart-line" }, { "screen": "failed", "icon": "alert" } ] },
"screens": [
  { "id": "today", "title": "Today", "body": [ ] },
  { "id": "charge", "title": "{{ route.params.id }}", "params": { "id": "text" }, "presentation": "sheet", "body": [ ] }
]
```

- `navigation.type`: tabs, stack, drawer or single.
- A screen's `presentation`: push, sheet, modal or fullscreen.
- `body` is a list of blocks (section 9).

## 9. Blocks

Every block has `type`, optional `id`, optional `when` (an expression that shows or hides it), optional `style` (token-based overrides) and, for interactive blocks, a required `label` for people and agents.

Layout:
- `stack` (vertical or horizontal, `gap`, `align`), `grid` (`columns`, responsive), `scroll`, `section` (title, collapsible), `card` (variant: plain, outlined, filled, hero), `tabs`, `carousel`, `split`, `spacer`, `divider`.

Content:
- `text` (variant: display, title, body, caption, mono; supports expressions), `stat` (value, label, delta, trend), `image`, `avatar`, `badge`, `icon`, `progress` (bar or ring), `empty` (illustration + message + action), `markdown`.

Data views:
- `list` (`from`, `item` template, swipe actions, grouping, pull to refresh, drag to reorder), `table`, `chart` (line, area, bar, stacked, donut, ring, sparkline, scatter, heatmap; `x`, `y`, `series`), `calendar` (month, week, agenda), `kanban`, `timeline`, `map` (pins from data).

Input:
- `form` (fields with type, validation, defaults; submits to an action), `button` (variant: primary, secondary, ghost, danger), `toggle`, `segmented`, `slider`, `search`, `date`, `picker`, `chips`, `rating`, `camera`, `scanner`, `file`.

Drawing:
- `vector`: a declarative SVG-like block (rect, circle, path, text, gradient) bound to data, for unique gauges, illustrations and charts.

Motion:
- `motion` on any block: enter (fade, slide, scale), on change (count up, pulse), and gestures (swipe, long press). Respects reduce-motion settings.

Example, the "Today" screen:

```json
{ "type": "stack", "gap": "lg", "children": [
  { "type": "stat", "label": "Revenue today", "value": "{{ money(revenueToday, 'EUR') }}", "delta": "{{ percent(revenueToday / revenueYesterday - 1) }}", "variant": "hero" },
  { "type": "segmented", "label": "Period", "bind": "state.period", "options": ["day", "week", "month"] },
  { "type": "chart", "kind": "area", "from": "charges", "x": "{{ formatDate(item.created, 'day') }}", "y": "{{ item.amount / 100 }}", "aggregate": "sum", "label": "Revenue by day" },
  { "type": "list", "label": "Failed payments", "from": "{{ charges.filter(c, c.status == 'failed') }}",
    "item": { "title": "{{ orElse(item.billing_details.name, 'Unknown') }}", "subtitle": "{{ item.failure_message }}", "trailing": "{{ money(item.amount / 100, item.currency) }}" },
    "onPress": { "navigate": "charge", "params": { "id": "{{ item.id }}" } },
    "empty": { "message": "No failed payments today" } }
] }
```

## 10. Actions

Actions are named operations. Each one is callable from the UI and is automatically published as a typed MCP tool for agents, with its inputs as a JSON Schema.

```json
"actions": {
  "stripe_summary": {
    "description": "Revenue, new customers and failed payments for a period.",
    "input": { "period": { "type": "enum", "options": ["day", "week", "month"], "default": "day" } },
    "returns": { "revenue": "money", "customers": "number", "failed": "number" },
    "do": [ { "refresh": "charges" }, { "return": { "revenue": "{{ revenueToday }}", "customers": "{{ count(unique(charges, 'customer')) }}", "failed": "{{ count(charges.filter(c, c.status == 'failed')) }}" } } ]
  },
  "add_goal": {
    "description": "Add a revenue goal.",
    "input": { "title": { "type": "text" }, "target": { "type": "money" }, "due": { "type": "date" } },
    "do": [ { "insert": "goals", "value": "{{ input }}" }, { "toast": "Goal added" } ]
  }
}
```

Steps (v0): `refresh`, `insert`, `update`, `delete` (collections), `http` (calls to `write` domains; needs approval), `set` (state), `navigate`, `notify`, `toast`, `confirm` (asks the person), `if`, `return`.

Rules:
- Every interactive block either calls a named action or a single built-in step. UI-only steps (navigate, set) are not published to agents.
- Actions that change data outside the app (`http` writes) are marked `"effect": "external"` automatically and always go through the one-time approval flow unless the person granted standing permission.
- Agents see the same action list in `describe_app`, plus the screen's labelled tree, so they can use the UI or call actions directly.

## 11. Schedules and notifications

```json
"schedules": [ { "id": "morning", "cron": "0 8 * * *", "tz": "person", "do": [ { "call": "stripe_summary", "with": { "period": "day" } }, { "notify": { "title": "Stripe today", "body": "{{ money(result.revenue, 'EUR') }}, {{ result.failed }} failed" } } ] } ]
```

Schedules run on Shipvo's edge in the person's time zone. Results can notify the phone and post back to the assistant's chat where the platform supports it.

## 12. Strings and languages

`strings` holds translations keyed by language (`"strings": { "fr": { "Revenue today": "Revenus du jour" } }`). Text matching a key is translated for the person's language; numbers, money and dates are formatted for their locale.

## 13. Validation

The validator runs before every preview, install and update. It returns errors the assistant can fix, each with a JSON path and a suggestion.

Errors (refused): schema violations; HTTP to undeclared domains; anything that looks like a secret value; interactive blocks without `label`; text contrast under WCAG AA; expressions that reference unknown names or exceed the step limit; more than 40 screens or 2,000 blocks.

Warnings (shown, not refused): touch targets under 44 px, more than three type sizes on one screen, inconsistent spacing, lists without an empty state, charts without a label, actions without a description.

## 14. Versioning and updates

- `spec` names the schema version. The engine supports the current and previous version; newer fields are refused by older engines.
- Every change to an installed app's spec is a new signed release, delivered over the air, with the same staged rollout and rollback as any Shipvo update.
- Collections migrate automatically when fields are added; removing or retyping a field needs an explicit `migrate` step.

## 15. Where apps are made, and the escape hatches

### 15.1 Surfaces: the chat first, every MCP server the same

The main user is a person in a chat assistant (ChatGPT, Claude, Gemini) connected to Shipvo's **remote MCP server**. There is no terminal: every step is an MCP tool plus a card in the chat. Coding agents (Claude Code, Cursor, Codex) use the **local stdio MCP server** (`npx -y @shipvo/mcp`). The CLI is a third door for developers.

**Parity rule:** the remote and stdio servers expose the same tools, with the same names, input and output schemas, error codes and approval steps. Both are built from one shared tool registry (one package both servers import); a CI test fails if their tool lists or schemas differ. Differences are only in where work runs and how a person signs in:

| | Remote MCP (chat assistants) | Stdio MCP (coding agents) |
| --- | --- | --- |
| Sign in | OAuth in the chat | `shipvo login` once, or a project token |
| Validation, bundling of islands and functions | Shipvo's edge | Locally, same engine package, same checks |
| Preview | Inline phone card in the chat | Shipvo Phone in the person's browser (`shipvo run`), plus the same live session for the agent |
| Secrets | Vault form inside the chat (inline UI, URL elicitation or a vault link) | The vault page opened in the person's browser; never typed into the terminal or the agent |
| Export | To the person's GitHub, a zip link, or PiPilot | The same, plus straight into a local folder |
| Approvals (new code, new domains, money) | Approval card in the chat | The same approval, in the vault/approval page in the browser; an agent can never approve its own request |

The CLI calls the same engine, so `shipvo app create`, `shipvo app export` and the MCP tools run the same code.

### 15.2 The ladder

Most apps never leave the spec. Those that need more climb one step and keep the contract: typed actions for agents, labelled screens, declared permissions, vault keys, signed releases, over-the-air updates and the Shipvo check. An agent cannot tell which level an app is on.

| Level | For | MCP tool (remote and stdio) | Card the person sees |
| --- | --- | --- | --- |
| 0 Spec | Most apps | `create_app(spec)`, `update_app(app, patch)`, `preview_app(app)`, `install_app(app)` | Live phone preview; install card |
| 1 Rich blocks | Unique looks, custom charts, gauges | Same tools (vector, motion and theme are part of the spec) | Same |
| 2 Code island | One special piece of UI (signature pad, game board, 3D viewer) | `add_component(app, name, code, props, events, labels)` | "New custom part: signature pad. Runs isolated, no internet." Review, then Add |
| 3 Server function | Logic CEL cannot express: multi-step integrations, webhooks, reconciliation | `add_function(app, name, code, input, output, domains, secrets, schedule?)` | "New logic: reconcile. Can reach shopify.com and stripe.com with your saved keys. Runs nightly." Approve |
| 4 Export | Apps that outgrow the spec, or go to the stores | `export_app(app, to: "github" \| "zip" \| "pipilot" \| "folder")` | "Exported to github.com/you/stripe-tracker", a download link, or "Opened in PiPilot" |
| 5 Native | Hardware or OS features with no web equivalent | none: the assistant explains it needs a store build and offers export | Explanation and next step |

### 15.3 Level 2: code islands

- The spec gets `{ "type": "custom", "component": "signature-pad", "props": { }, "label": "Signature" }`.
- The code (React for web, TypeScript or JavaScript) arrives inside the tool call, written by the assistant's own model. Shipvo bundles it in seconds; there is no separate build server.
- It runs isolated (its own frame on Shipvo Phone), talks to the app only through declared props in and events out, has no network unless declared, and never sees the vault.
- It must declare its accessible labels and its events; each event becomes a typed action (`signature_captured`). Missing declarations are validation errors.
- Checks before it is added: size limit, no undeclared network, no secret-like strings, no dynamic code loading. Failures return exact errors so the assistant can fix and resend.
- Adding or changing an island needs the person's approval card. Public listings with islands also get a human review.

### 15.4 Level 3: server functions

- An action can be `{ "run": "function", "function": "reconcile" }`; the function is TypeScript sent in `add_function`.
- It runs on Shipvo's edge in an isolate (remote) or locally in the same isolate engine during development (stdio), with: typed input and output (so it is still an MCP tool), vault secrets by name only, network only to declared domains, CPU and time limits, logs visible to the person.
- Optional schedule (cron in the person's time zone) and optional webhook endpoint (`/hooks/<app>/<function>`, signed).
- Adding a function, or widening its domains or secrets, needs the person's approval card.
- It is the only level that runs custom code per call, so it is metered: a free allowance, then paid.

### 15.5 Level 4: export

- `export_app` writes a normal Shipvo React Native project: screens as components, data as hooks, the theme as a token file, actions as typed owner commands, islands as components, functions as server code. MCP tools, labels, permissions and secret names carry over; secret values never leave the vault.
- Destinations: the person's GitHub (they connect GitHub once with OAuth; we create the repo in their account), a zip download link, PiPilot (opens as a project there), or a local folder (stdio and CLI only).
- One way by design: the export card lists what becomes code and asks to confirm. The spec stays in the project history as the starting point. After export the app keeps running on the person's phone, now updated from the exported project.
- Store builds happen after export, through EAS or the team's own CI. Shipvo does not build store binaries.

### 15.6 Level 5: native modules

Only for real phones (Bluetooth devices, background location, custom native SDKs). On Shipvo Phone a native-only feature needs a web fallback or a simulated version in `@shipvo/device`; publish checks flag anything that will not work there.

### 15.7 The Shipvo Runner

App specs run on Shipvo's edge in one shared runner: it reads each app's spec and executes its data sources (vault keys added server-side), CEL expressions, actions, schedules and webhooks.

- **It never runs code written by users or assistants.** No `eval`, no dynamic import: such code would run with Shipvo's credentials and could see other people's data. User-written code (levels 2 and 3) runs only in a separate isolated tier, one isolate per person, never in the shared runner.
- **Built to be efficient:** each call does little CPU work (upstream responses are trimmed to the fields the spec uses; CEL has a cost limit), all schedules go through one dispatcher instead of one timer per app, and upstream calls are cached per the spec's `cache` setting.
- **Fair use.** Each person and app has usage quotas. When a quota is reached, the person sees a plain message and how to get more; quota numbers are set in configuration, not in this document.
- **Stdio parity.** The local stdio MCP runs the same runner with `workerd` (the open-source Workers runtime), so a coding agent tests exactly what runs on the edge.

### 15.8 Specs on real phones: the Shipvo player app

One Shipvo app on Google Play and the App Store, containing the engine. People install it once; every app their assistant builds for them appears inside it, updated over the air, with no store submission per app. Android first. iOS needs a policy check before we commit: Apple's guidelines on apps that run downloaded content allow some mini-app and HTML5 experiences under conditions (no change of the app's main purpose, no downloaded executable native code, reviewable content). Specs are data, not code, which helps; islands and functions need a careful reading. This is a decision for the owner (strategy doc).

## 16. Open questions

1. ~~Expression language~~: decided, CEL with `@bufbuild/cel` and the Shipvo function library (section 7).
2. How much custom styling per block before apps become inconsistent: tokens only, or limited per-block overrides?
3. Sharing: can a person publish a personal app as a template for others (with secrets removed)?
4. Real phones: the Shipvo player app (15.7), Android first; iOS after a policy check. Owner decision.
