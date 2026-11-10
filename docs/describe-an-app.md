# Describe an app and it appears

For founders and makers who want a small app on a phone in a minute, and for developers who drive the simulator from an assistant. You will ask your assistant for an app, hold it on an Android or iOS phone, change it without losing what you typed, and read what was changed.

## What you get

- You describe the app in plain words. Your assistant writes a short spec (a JSON file that lists screens, buttons and data).
- Shipvo checks the spec and puts the app on the phone with an icon. It opens at once.
- Every control is labelled, so the same `screen`, `tap`, `type` and `scroll` tools work on it as on any app.
- A change is a new version of the same app. What people entered stays.
- `app_activity` lists each version and what changed.

Android and iOS work the same way. Pick the look with `style`: `"android"` (the default) or `"ios"` for the iPhone look. Both are covered in [Phone apps](phone-apps.md#describe-an-app-and-it-appears).

## Before you start

You need a phone session your assistant can reach: the hosted phone, `shipvo run android` or `shipvo run ios`, or `shipvo sim`. See [Test with an assistant](test-with-an-assistant.md) to connect one.

## Steps

1. Ask your assistant: "Make a weekly planner on the phone." It calls `create_app` with an id and a spec.
2. Look at the phone. The Weekly planner icon is on the home screen and the app is open. If you want to stay where you are, ask for `open: false`.
3. Ask it to add a task: "Add 'call the printer' on Monday." It types into the form and taps the button, or calls `run_app_action` with the action name and input.
4. Ask for a change: "Add an About screen." The assistant calls `update_app` with the whole new spec. The open screen shows the new look at once and the task is still there.
5. Ask: "What did you change?" The assistant calls `app_activity`. You see lines such as `added screen 'about'`.

## A small spec

This spec is valid and was checked with `validate` from `@shipvo/spec`. It has one screen, a form and a list.

```json
{
  "spec": "shipvo.app/v0",
  "app": {
    "id": "planner",
    "name": "Weekly planner",
    "description": "Write down what to do each day."
  },
  "data": {
    "tasks": {
      "source": "collection",
      "fields": {
        "day": "text",
        "task": "text"
      },
      "seed": []
    }
  },
  "screens": [
    {
      "id": "home",
      "title": "This week",
      "body": [
        {
          "type": "form",
          "label": "Add task form",
          "submit": {
            "label": "Add task",
            "action": "add_task"
          },
          "fields": [
            {
              "name": "day",
              "type": "text",
              "label": "Day",
              "required": true
            },
            {
              "name": "task",
              "type": "text",
              "label": "Task",
              "required": true
            }
          ]
        },
        {
          "type": "list",
          "label": "Tasks",
          "from": "{{ tasks }}",
          "item": {
            "title": "{{ item.task }}",
            "subtitle": "{{ item.day }}"
          },
          "empty": {
            "message": "Nothing planned yet"
          }
        }
      ]
    }
  ],
  "actions": {
    "add_task": {
      "description": "Add a task to a day.",
      "input": {
        "day": {
          "type": "text"
        },
        "task": {
          "type": "text"
        }
      },
      "do": [
        {
          "insert": "tasks",
          "value": {
            "day": "{{ input.day }}",
            "task": "{{ input.task }}"
          }
        },
        {
          "toast": "Task added"
        }
      ]
    }
  }
}
```

Save the spec above as `planner.json`. Then check it before you send it:

```bash
npm install @shipvo/spec
cat > check.mjs <<'EOF'
import { readFileSync } from "node:fs";
import { validate } from "@shipvo/spec";

console.log(validate(JSON.parse(readFileSync("planner.json", "utf8"))));
EOF
node check.mjs
```

Expected output: `{ errors: [], warnings: [] }`.

More starting points are in the [spec gallery](spec-blocks.md#example-specs): habit tracker, workout log, expense splitter, trip checklist and flashcards.

## Tools

| Tool | What it does |
| --- | --- |
| `create_app { session, id, spec, style?, open? }` | Checks the spec and installs the app. |
| `update_app { session, id, spec }` | Replaces the spec as a new version. Entered data and settings stay. |
| `run_app_action { session, id, action, input }` | Runs one action of the spec by name, like its form does. |
| `refresh_app { session, id }` | Fetches the app's `http` data sources now. |
| `app_activity { session, id?, limit? }` | Returns `history`, `sources` and `events`. |
| `export_phone_apps`, `import_phone_apps` | Move your apps to another phone. |

Every option and error is in [Phone apps](phone-apps.md#describe-an-app-and-it-appears). The spec format is in [App spec](spec-blocks.md).

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `invalid_spec` | The spec has problems. Nothing was installed. | Read each problem: it has a path (such as `$.actions.add_task.do`) and a fix. Correct the spec and call again. |
| `already_installed` from `import_phone_apps` | An app with that id is already on the phone. | Pass `replace: true`, or use `update_app` to change the app. |
| `action_failed` | The action refused the input. | Read the reason in the result, then send a valid value. |
| A form you typed in starts empty after an update | The app is rebuilt and the page reloads. Entered data stays; unsent form text and the back stack do not. | Submit the form before asking for a change. |
| The app's data is gone | The app's data stays with the session and the installed app. | `export_phone_apps` saves it and `import_phone_apps` brings it back. |

## Next steps

- [Phone apps](phone-apps.md): the home screen, the Store and every option.
- [App spec](spec-blocks.md): every block you can use.
- [Test with an assistant](test-with-an-assistant.md): let your assistant test what it built.
