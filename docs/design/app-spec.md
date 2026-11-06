# Shipvo app spec, v0 (draft)

Status: draft for review by the owner, 6 Nov 2026. Nothing here is built yet.

A Shipvo app spec is a JSON document that describes a whole app: its look, its data, its screens, its logic and the actions agents can call. An assistant writes the spec; the Shipvo app engine validates it and renders it as a native-feeling app on Shipvo Phone (and, later, on real phones through the native shell). No AI runs after the spec is written: the same spec always gives the same app.

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
    "query": { "limit": 100, "created[gte]": "{{ startOf('day', now()) | unix }}" },
    "auth": { "secret": "STRIPE_KEY", "type": "bearer" },
    "select": "data",
    "cache": "5m",
    "paginate": { "type": "cursor", "param": "starting_after", "next": "last(data).id", "until": "!has_more" }
  },
  "goals": {
    "source": "collection",
    "fields": { "title": "text", "target": "number", "due": "date", "done": "bool" },
    "seed": []
  },
  "revenueToday": {
    "source": "computed",
    "value": "{{ sum(filter(charges, c => c.status == 'succeeded'), 'amount') / 100 }}"
  }
}
```

- `http` sources run on Shipvo's edge, never in the browser, so the vault key is added server-side. Responses are cached per `cache`.
- `collection` sources are the app's own local data, stored per person on their phone (synced to their account). Field types: text, number, money, date, datetime, bool, enum, image, file, ref.
- `computed` values use the expression language (section 7) and update when their inputs change.

## 6. State

Screen-independent values the app keeps while running (filters, selected tab, form drafts).

```json
"state": { "period": { "type": "enum", "options": ["day", "week", "month"], "default": "day" } }
```

## 7. Expressions

A small, safe expression language inside `{{ }}`, like spreadsheet formulas. It cannot loop forever, call the network or reach anything undeclared. Evaluation has a step limit.

- Values: numbers, strings, booleans, null, lists, objects, dates, money.
- Operators: `+ - * / %`, comparisons, `&& || !`, `? :`, `??`.
- Access: `data.charges`, `state.period`, `item.amount`, `route.params.id`.
- Lambdas only as arguments: `c => c.status == 'paid'`.
- Pipes for formatting: `{{ revenueToday | money('EUR') }}`.
- Functions (v0): `sum avg min max count filter map sort group first last unique`, `now today startOf endOf addDays diff formatDate unix`, `money number percent compact`, `lower upper trim contains split join`, `if coalesce`.

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
  { "type": "stat", "label": "Revenue today", "value": "{{ revenueToday | money('EUR') }}", "delta": "{{ percent(revenueToday / revenueYesterday - 1) }}", "variant": "hero" },
  { "type": "segmented", "label": "Period", "bind": "state.period", "options": ["day", "week", "month"] },
  { "type": "chart", "kind": "area", "from": "charges", "x": "created | formatDate('day')", "y": "sum(amount) / 100", "label": "Revenue by day" },
  { "type": "list", "label": "Failed payments", "from": "{{ filter(charges, c => c.status == 'failed') }}",
    "item": { "title": "{{ item.billing_details.name ?? 'Unknown' }}", "subtitle": "{{ item.failure_message }}", "trailing": "{{ item.amount / 100 | money(item.currency) }}" },
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
    "do": [ { "refresh": "charges" }, { "return": { "revenue": "{{ revenueToday }}", "customers": "{{ count(unique(charges, 'customer')) }}", "failed": "{{ count(filter(charges, c => c.status == 'failed')) }}" } } ]
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
"schedules": [ { "id": "morning", "cron": "0 8 * * *", "tz": "person", "do": [ { "call": "stripe_summary", "with": { "period": "day" } }, { "notify": { "title": "Stripe today", "body": "{{ result.revenue | money('EUR') }}, {{ result.failed }} failed" } } ] } ]
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

## 15. Escape hatch

`shipvo eject <app>` turns a spec into a normal Shipvo React Native project (screens, components, actions as code) for apps that outgrow the spec. Designed separately.

## 16. Open questions

1. Expression language: write our own, or adopt an existing safe one (CEL, JSONata) with our functions added?
2. How much custom styling per block before apps become inconsistent: tokens only, or limited per-block overrides?
3. Sharing: can a person publish a personal app as a template for others (with secrets removed)?
4. Real phones: ship the engine inside the native shell so specs run natively, or only export to code?
