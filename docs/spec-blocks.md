# App spec: screens, controls and sheets

This page is for developers and for coding agents that write a Shipvo app spec (`shipvo.app/v0`). You will build one screen from the display and control blocks, check it, render it as Android or iOS, and change its state from a test. The full format is in the [design document](design/app-spec.md). The package is `@shipvo/spec`.

## Install

```bash
npm install @shipvo/spec
```

## 1. Write the spec

Save this as `today.json`. It uses `stat`, `segmented`, `card`, `progress`, `divider`, `section`, `toggle` and a sheet.

```json
{
  "spec": "shipvo.app/v0",
  "app": { "id": "today", "name": "Revenue", "description": "Revenue today." },
  "state": {
    "period": { "type": "enum", "options": ["day", "week", "month"], "default": "day" },
    "alerts": { "type": "bool", "default": false }
  },
  "screens": [
    { "id": "today", "title": "Today", "body": [
      { "type": "stack", "gap": "lg", "children": [
        { "type": "stat", "label": "Revenue today", "value": "1250 EUR", "delta": "+12%", "variant": "hero" },
        { "type": "segmented", "label": "Period", "bind": "state.period", "options": ["day", "week", "month"] },
        { "type": "card", "variant": "outlined", "label": "Goal", "children": [
          { "type": "progress", "label": "Monthly goal", "value": 40, "max": 100 },
          { "type": "progress", "label": "Goal ring", "variant": "ring", "value": 75 }
        ] },
        { "type": "divider" },
        { "type": "section", "title": "Settings", "children": [
          { "type": "toggle", "label": "Failed payment alerts", "bind": "state.alerts" }
        ] },
        { "type": "button", "label": "Details", "onPress": { "navigate": "details", "presentation": "sheet" } }
      ] }
    ] },
    { "id": "details", "title": "Details", "presentation": "sheet", "body": [
      { "type": "text", "value": "Revenue so far today." },
      { "type": "button", "label": "Done", "onPress": { "back": true } }
    ] }
  ]
}
```

## 2. Check it

```ts
import { readFileSync } from "node:fs";
import { validate } from "@shipvo/spec";

const spec = JSON.parse(readFileSync("today.json", "utf8"));
console.log(validate(spec)); // { errors: [], warnings: [] }
```

## 3. Render it

```ts
import { renderScreen, describeTree } from "@shipvo/spec";

const r = renderScreen(spec, { style: "ios" }); // or "android"
if (r.ok) console.log(describeTree(r.tree));
```

Expected output. Android and iOS give the same tree; only the styling differs.

```text
main "Today"
  group ""
    status "Revenue today: 1250 EUR, +12%"
    radiogroup "Period: day"
      radio "day"
      radio "week"
      radio "month"
    group "Goal"
      progressbar "Monthly goal: 40%"
      progressbar "Goal ring: 75%"
    separator ""
    region "Settings"
      switch "Failed payment alerts: off"
    button "Details"
```

## 4. Use it like an app

`createApp` keeps state between actions. `app.state` starts with the defaults you declared.

```ts
import { createApp } from "@shipvo/spec";

const made = createApp(spec);
if (!made.ok) throw new Error(JSON.stringify(made.errors));
const app = made.app;

app.toggle("Failed payment alerts");   // { ok: true, value: true }
app.select("Period", "week");          // { ok: true, value: "week" }
app.state;                             // { period: "week", alerts: true }
app.press("Details");                  // opens the sheet; app.screen is "details"
app.press("Done");                     // back to "today"
app.select("Period", "year");          // { ok: false, error: '"year" is not one of: day, week, month.' }
```

## Blocks

| Block | Use it for | Main options |
| --- | --- | --- |
| `stat` | One number with a label | `label`, `value`, `delta`, `variant` (`hero`) |
| `progress` | A bar or ring | `label`, `value`, `max` (default 100), `variant` (`ring` for a ring) |
| `card` | A grouped area | `label`, `variant` (`plain`, `outlined`, `filled`), `children` |
| `section` | A titled group | `title`, `children` |
| `divider` | A line between groups | none |
| `toggle` | On or off | `label`, `bind` to a `bool` state value |
| `segmented` | One choice from a few | `label`, `bind` to an `enum` state value, `options` |
| `kanban` | Cards in columns | `label`, `from`, `columns`, `column`, `title`, `detail`, `onMove` |
| `timeline` | Dated entries, newest day first | `label`, `from`, `date`, `title`, `detail` |
| `calendar` | Events in a month, a week or an agenda | `label`, `from`, `date`, `title`, `detail`, `view`, `at`, `onSelect` |
| `map` | Pins on a canvas | `label`, `from`, `lat`, `lng`, `title`, `onSelect` |
| `vector` | A small drawing that follows your data | `label`, `value`, `width`, `height`, `shapes`, `motion` |

In the screen tree, a toggle reads `Failed payment alerts: off` or `: on`, a segmented control reads `Period: week`, and a progress block reads `Monthly goal: 40%`. Assistants and `@shipvo/test` find them by those names.

## Boards and timelines

A `kanban` block shows the rows of a data source as cards in columns. A `timeline` block shows them grouped by day. Both need a `label` and a `from` (the name of a source in `data`); the rest are expressions that run once per row as `item`.

```json
{ "type": "kanban", "label": "Task board", "from": "tasks", "columns": ["todo", "doing", "done"],
  "column": "{{ item.status }}", "title": "{{ item.title }}", "detail": "{{ item.note }}",
  "onMove": { "action": "move_task", "input": { "id": "{{ item.id }}", "status": "{{ column }}" } } }
{ "type": "timeline", "label": "History", "from": "tasks", "date": "{{ item.at }}", "title": "{{ item.title }}", "detail": "{{ item.note }}" }
```

- `columns` is a list of unique names. Every row's `column` value must be one of them.
- `onMove` names an action from `actions`. It runs when a card moves, and `{{ column }}` is the new column.
- `date` is `2026-11-07` or `2026-11-07T09:30`. The timeline groups by the date part.
- In the screen tree a column reads `todo, 2 cards` and a card reads `Buy bait, Worms` (title, then detail), on the Android and iPhone skins.
- `app.move("Buy bait", "done")` moves a card by its title and runs `onMove`. It answers `ok: false` if the card or the column does not exist.

The validator reports a bad column list, a card in a column the board does not have, a missing or invalid date, and an undeclared `onMove` action, each with a path and a fix.

## Calendars and maps

A `calendar` block shows the rows of a data source as events. A `map` block shows them as pins. Both need a `label` and a `from` (the name of a source in `data`); the rest are expressions that run once per row as `item`.

```json
{ "type": "calendar", "label": "Plans", "view": "agenda", "from": "events",
  "date": "{{ item.at }}", "title": "{{ item.name }}",
  "onSelect": { "action": "pick", "input": { "id": "{{ item.id }}" } } }
{ "type": "map", "label": "Places", "from": "places",
  "lat": "{{ item.lat }}", "lng": "{{ item.lng }}", "title": "{{ item.name }}",
  "onSelect": { "action": "pick", "input": { "id": "{{ item.id }}" } } }
```

- `view` is `month` (the default), `week` (Monday first) or `agenda` (a list of the days that have events).
- `at` is the day the month or week is built around, such as `2026-11-10`, or an expression in `{{ }}`. Without it the view starts at the first event.
- `date` is `2026-11-07` or `2026-11-07T09:30`. Events are sorted by date, and a time shows before the title.
- `detail` is optional text after the event title.
- The map draws pins on a canvas that fits all of them. It makes no network calls and has no map tiles. `lat` is from -90 to 90 and `lng` from -180 to 180; a row with other values draws no pin.
- `onSelect` names an action from `actions`. The action gets the row as `{{ item }}`. `app.press("Castle")` runs it for the event or pin with that title.
- In the screen tree an event reads `Flight to Lisbon` (title, then detail) inside a group named for its day, and a pin reads `Hotel`, on the Android and iPhone skins.

The validator reports a missing `from`, `date`, `title`, `lat` or `lng`, a `view` that is not supported, a bad `at`, a bad seed date, latitude or longitude, and an undeclared `onSelect` action, each with a JSON path and a fix.

## Vector drawings

A `vector` block draws shapes whose numbers and colours come from expressions, so a gauge or a mini chart follows your state. It needs a `label` (what a screen reader says). `value` is the short text added to its name in the screen tree.

```json
{ "type": "vector", "label": "Battery", "value": "{{ state.level }}%", "width": 120, "height": 40,
  "shapes": [
    { "shape": "rect", "x": 0, "y": 0, "width": "{{ state.level }}", "height": 20, "rx": 4, "fill": "#0B5FFF" },
    { "shape": "text", "x": 0, "y": 38, "text": "{{ state.level }}%", "fontSize": 10 }
  ] }
```

| Shape | Options |
| --- | --- |
| `rect` | `x`, `y`, `width`, `height`, `rx`, `fill`, `stroke`, `strokeWidth`, `opacity` |
| `circle` | `cx`, `cy`, `r`, `fill`, `stroke`, `strokeWidth`, `opacity` |
| `path` | `d` (path commands such as `M 0 30 L 100 30`), `fill`, `stroke`, `strokeWidth`, `opacity` |
| `text` | `x`, `y`, `text`, `fontSize`, `fill`, `anchor` (`start`, `middle`, `end`), `opacity` |
| `linearGradient` | `id`, `x1`, `y1`, `x2`, `y2`, `stops` (each `offset` from 0 to 1 and `color`). Use it as `fill: "url(#id)"`. |

Each option can be a number, a colour or an expression. Colours that are not a hex value, a colour name or `url(#id)` draw as `none`. In the screen tree the block is an image named `Battery: 40%` on the Android and iPhone skins. An unknown shape is a validation error with its JSON path and the list of shapes.

## Motion

Any block can carry `motion`:

```json
{ "type": "stat", "label": "Revenue", "value": "{{ state.total }}", "motion": { "enter": "fade", "change": "countUp" } }
```

- `enter` is `fade`, `slide` or `scale`. It plays when the block appears.
- `change` is `countUp` or `pulse`. It plays when the block's value changes.

Set the theme `motion` to `"none"`, or pass `reduceMotion: true` to `renderScreen`, and no node carries animation fields. The simulated phone passes its reduce-motion setting through, so a test can check both modes.

## Translations and right-to-left

Add `strings` to the spec: a map from language to `{ "original text": "translated text" }`.

```json
{ "strings": { "fr": { "Battery level": "Niveau de batterie" } } }
```

`renderScreen(spec, { language: "fr", locale: "fr-FR" })` replaces any text that matches a key. Text with no match stays as written. `money(...)` and `formatDate(...)` use the `locale`. Right-to-left languages such as Arabic and Hebrew set `dir: "rtl"` on the screen tree and on the HTML; other languages set `dir: "ltr"`. `validate` warns about a `strings` key that no text in the spec uses.

## Sheets

Add `"presentation": "sheet"` to a screen and to the `navigate` action that opens it. The screen appears as a bottom sheet (a `dialog` in the tree). `{ "back": true }` closes it.

## Data that stays fresh

Add `refresh` to an `http` data source and Shipvo fetches it again on that many seconds while the app is installed. A pinned or long-open app shows current prices or counts with no tap.

```json
"permissions": { "network": ["api.example.com"] },
"data": {
  "price": { "source": "http", "get": "https://api.example.com/price", "refresh": 60 }
}
```

- `refresh` is in seconds, 30 or more. The next screen render and the labelled tree show the new value.
- Each refresh uses the same domain checks, size limits and trimming as the first fetch. Refreshed values are not written to the `cache`.
- A failed refresh keeps the last value. A source never overlaps itself.
- Refreshing stops when the app is uninstalled or the session ends, and restarts when you update the spec.

| Error | Fix |
| --- | --- |
| `10 is below the minimum 30.` (`$.data.price.refresh`) | Use 30 or more. |
| `refresh is only for http data sources.` | Remove `refresh`, or change the source to `http`. |

## Example specs

`packages/spec/gallery/` holds complete specs to copy and change: a habit tracker and a workout log. Each has a collection, a computed total, an action, a form, a bar chart and a list. The workout log uses a dark theme. The gallery tests check that each spec passes `validate`, renders the same tree on the Android and iOS skins, and runs its action.

```bash
cp packages/spec/gallery/habit-tracker.json my-app.json
```

## Data sources that use a saved key

A data source can call a service with a key you saved once in the secret form. The spec holds only the key's name. The key never reaches the assistant, the spec or the screen.

```json
"secrets": [{ "name": "STRIPE_KEY", "service": "stripe" }],
"permissions": { "network": ["api.stripe.com"] },
"data": {
  "charges": {
    "source": "http",
    "get": "https://api.stripe.com/v1/charges",
    "auth": { "secret": "STRIPE_KEY", "type": "bearer" }
  }
}
```

`type` is `bearer` (default), `basic`, `header` or `query`. For `header` and `query`, `name` sets the header or parameter. Rules the runner enforces:

- The key opens only for the person who saved it, in this app, for the exact domain it was saved for. Subdomains do not match.
- Redirects are not followed. Any redirect is an error, so the key cannot travel to another host.
- If the service echoes the key back, it is replaced with `[hidden]` before the data is read.
- Authed sources are cached only when the host sets a cache scope, so two people never share one entry.

| Code | Meaning | Fix |
| --- | --- | --- |
| `secret_missing` | The key is not saved. | Add it through the secret form. |
| `secret_revoked` | The key was revoked. | Save it again; saving clears the revocation. |
| `secret_domain` | The key is saved for a different service than the URL's host. No request was sent. | Save the key for this domain, or fix the URL. |

## Errors you may see

`validate` returns the JSON path and a fix for each error.

| Error | Fix |
| --- | --- |
| `Interactive block "toggle" has no label.` | Add `label`. |
| `State "nope" is not declared.` | Add the key to `state` with a type and a default. |
| `"a" does not match the required format.` (`$.app.id`) | Use lowercase letters, digits and `-`, 2 to 63 characters, starting with a letter. |
| `Segmented control has no options.` | Add `options`: a list of two or more short texts, for example `["day", "week", "month"]`. |

## Troubleshooting

- **`createApp` returns `ok: false`.** The spec has validation errors. Print `made.errors`; each has a path and a fix.
- **`toggle` or `select` answers `ok: false`.** The label does not match a control on the current screen, or the option is not in `options`. Labels are case-sensitive.
- **`Card column "later" is not a board column.`** A row has a column value that is not in `columns`. Use one of the listed names or add the column.
- **`Entry date "tomorrow" is not a date.`** Use `2026-11-07` or `2026-11-07T09:30`.
- **`Calendar view "year" is not supported.`** Use `month`, `week` or `agenda`.
- **`Event date "soon" is not a date.`** Use `2026-11-07` or `2026-11-07T09:30` in the source's seed rows.
- **`Pin latitude 95 is not valid.`** Latitude runs from -90 to 90 and longitude from -180 to 180.
- **A week or month view shows no events.** The view only lists events inside the days it shows. Set `at` to a day in the period you want, or use `agenda`.
- **A translation does not show.** The key must match the text exactly, including capitals and spaces, and `language` must be the same code you used in `strings` (`fr`, not `fr-FR`). Pass `locale` separately for money and dates.
- **A vector shape is missing.** An unknown `shape` is an error; a colour that is not hex, a name or `url(#id)` draws as `none`; a path with other characters draws nothing.
- **A refreshed value never changes.** Check that `refresh` is 30 or more and the source is `http`. A failed refresh keeps the last value, so check the domain is in `permissions.network`.
- **State is empty before the first change.** Declare a `default` for each `state` value. Declared defaults are present from the start.

## Next steps

- [`@shipvo/spec` package reference](../packages/spec/README.md): every check, expressions and charts.
- [Test your app in CI](testing.md): write typed tests against the screen tree.
- [Glossary](glossary.md).
