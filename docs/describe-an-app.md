# Describe an app and it appears

For founders and developers who want a small app on a phone, without writing React Native. You describe the app to your coding agent. The agent sends a short description (an *app spec*) to the Shipvo Phone, and the app appears on an Android or iOS phone with its own icon. You can tap it, type in it and ask for changes. Your entries stay when the app changes.

## What you need

- A coding agent set up with Shipvo: run `npx -y @shipvo/cli agents setup` (see [agents](agents.md)).
- An open phone session. Ask your agent: "Open a Shipvo phone and show it to me" (see [run on a phone in your browser](run.md)).

## Make an app, step by step

1. **Ask in plain words.** For example: "Make a gift ideas app on the phone. I want to write who each idea is for." The agent writes the spec for you. You do not need to read it.
2. **Watch the icon appear.** The agent calls `create_app`. The spec is checked first. If it is valid, the app gets an icon on the home screen of the Android or iOS phone and opens.
3. **Use it.** Tap, type, scroll. Every control has a name, so your agent can use the app too.
4. **Ask for a change.** "Add an About screen." The agent calls `update_app`. The open screen changes at once, and the gift ideas you typed are still there.
5. **See what changed.** Ask "What did you change?" The agent calls `app_activity` and answers with lines such as `added screen 'about'`.

If step 2 fails, the agent gets a list of problems, each with where it is and how to fix it. Nothing is installed until the spec is valid, so a failed try leaves the phone as it was. Your agent will fix the spec and try again.

## For developers: the tools

| Tool | What it does |
| --- | --- |
| `create_app { session, id, spec, name?, style?, open? }` | Checks the spec, installs the app and opens it. `style` is `"android"` (default) or `"ios"`. `open: false` stays on the current screen. |
| `update_app { session, id, spec }` | Replaces the spec as a new version of the same app. Data and settings people entered stay. The back stack and unsent form text start again. |
| `run_app_action { session, id, action, input }` | Runs one action by name, as its form would. |
| `refresh_app { session, id }` | Fetches the app's `http` data sources now. |
| `app_activity { session, id?, limit? }` | Versions with plain change lines, data sources, and events (create, update, action, data refresh). |
| `export_phone_apps` / `import_phone_apps` | Copy spec apps, with their data and layout, to another phone. |

The `id` you pass to `create_app` uses lowercase letters, digits and dashes, up to 40 characters, and it starts with a letter or digit. The `app.id` inside the spec follows the spec schema and is a separate rule.

Every call is logged in `device_log`. Details for each tool are in [phone apps](phone-apps.md#describe-an-app-and-it-appears). The spec format is in [app spec](design/app-spec.md), and every block you can use is in [spec blocks](spec-blocks.md). Eight complete examples are in `packages/spec/gallery`.

### A complete spec

This spec passes `validate` from `@shipvo/spec` with no errors and no warnings. It is a form and a list that fills as you add ideas.

```json
{
  "spec": "shipvo.app/v0",
  "app": { "id": "gifts", "name": "Gift ideas", "description": "Write down gift ideas for people." },
  "data": {
    "ideas": { "source": "collection", "fields": { "person": "text", "idea": "text" }, "seed": [] }
  },
  "screens": [
    {
      "id": "home",
      "title": "Gift ideas",
      "body": [
        {
          "type": "form",
          "label": "Add an idea",
          "submit": { "label": "Add", "action": "add_idea" },
          "fields": [
            { "name": "person", "type": "text", "label": "Who for", "required": true },
            { "name": "idea", "type": "text", "label": "Idea", "required": true }
          ]
        },
        {
          "type": "list",
          "label": "Ideas",
          "from": "{{ ideas }}",
          "item": { "title": "{{ item.person }}", "subtitle": "{{ item.idea }}" },
          "empty": { "message": "No ideas yet" }
        }
      ]
    }
  ],
  "actions": {
    "add_idea": {
      "description": "Save one gift idea for a person.",
      "input": { "person": { "type": "text" }, "idea": { "type": "text" } },
      "do": [
        { "insert": "ideas", "value": { "person": "{{ input.person }}", "idea": "{{ input.idea }}" } },
        { "toast": "Saved" }
      ]
    }
  }
}
```

Check any spec before you send it:

```bash
npm install @shipvo/spec
```

Save this as `check.mjs` next to `gift-ideas.json`, then run `node check.mjs`:

```js
import { readFileSync } from "node:fs";
import { validate } from "@shipvo/spec";

console.log(validate(JSON.parse(readFileSync("gift-ideas.json", "utf8"))));
```

Expected output:

```
{ errors: [], warnings: [] }
```

A spec with a mistake comes back with the path and the fix. For a button with no label:

```
$.screens[0].body[0]  Interactive block "button" has no label.
fix: Add "label": a short name that people and agents see, for example "Add goal".
```

## Troubleshooting

- **`invalid_spec`.** Read the `path` and `fix` of each problem. Common ones: a button or field without a `label`, an `app.id` that is not a lowercase letter followed by lowercase letters, digits or dashes (2 to 63 characters in all), a name used in `{{ }}` that is not in `data`, or palette text with too little contrast.
- **`bad_app_id`.** The id has a character the phone does not accept, such as a capital letter, a space or an underscore. The `create_app` id may use lowercase letters, digits and dashes, up to 40 characters, and it starts with a letter or digit, so `-gifts` is refused. A valid id is `gift-ideas`. This is a separate rule from the `app.id` in the spec.
- **`already_installed`.** An app with that id is on the phone. Use `update_app` to change it, or uninstall it first.
- **`not_installed` from `update_app` or `app_activity`.** The id is not an app made with `create_app`. Check the id on the home screen or with `list_apps`.
- **`action_failed`.** The action refused the input. The reason is in the error: for example a required field was empty.
- **My entries are gone.** An app's data lives for the session. It is dropped when the session ends or the app is uninstalled. Use `export_phone_apps` to keep it.

## Try it without installing anything

The [playground](getting-started.md#try-it-in-your-browser-first) shows phones in your browser. Open it to see the sample app on an Android phone and an iPhone side by side before you install anything.

## Next steps

- [Phone apps](phone-apps.md): every option, plus the Store, home screen and Settings.
- [Spec blocks](spec-blocks.md): charts, boards, calendars, maps, data sources and translations.
- [Agents and Shipvo apps](agents.md): the full tool list.
- [Glossary](glossary.md): what an app spec is.
