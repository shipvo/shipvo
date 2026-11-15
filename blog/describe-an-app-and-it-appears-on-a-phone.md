---
title: Describe an app in plain words and it appears on an Android or iOS phone
date: 2026-11-10
order: 28
author: Shipvo team
tags: Guides, Founders
seo_title: Describe an app and it appears on a phone
summary: Tell your coding agent what app you want. Shipvo checks the description, installs the app on an Android or iOS phone in your browser and keeps your data when you ask for changes.
cover: phone
kicker: Say it,|get an app
---

You have an idea for a small app. A list of gift ideas, a habit tracker, a packing checklist. You do not want to set up React Native to find out if the idea works. You want to say what you want and see it on a phone.

This post shows how that works in Shipvo: you describe the app to your coding agent, and it appears on an Android or iOS phone with its own icon. We cover what happens at each step, the commands behind it, and what you get when the description has a mistake.

## What "describe an app" means

Your coding agent (Claude, ChatGPT, Cursor or another that speaks MCP) writes a short description of the app, called an *app spec*. It is a small JSON file: the data the app keeps, the screens, and the actions. The agent sends it to Shipvo Phone, a phone that runs in your browser.

Shipvo checks the spec. If it is valid, the app gets an icon on the home screen and opens. You can tap it, type in it and scroll. Every control has a name, so your agent can use the app too.

This is the first step of the loop Shipvo is built around: your agent builds the app, tests it on a phone in your browser, records the demo, and ships it to the stores and to every phone. Here we only cover the first step.

## Make a mobile app with a coding agent, step by step

Set up your agent once:

```bash
npx -y @shipvo/cli agents setup
```

Then open a phone. Ask your agent: "Open a Shipvo phone and show it to me." The page is the same one `shipvo run` opens; see [see your React Native app on a phone in your browser](/blog/see-your-react-native-app-on-a-phone-in-your-browser/).

Now describe the app in plain words:

> Make a gift ideas app on the phone. I want to write who each idea is for.

The agent calls the `create_app` tool. The app appears on the phone. Type a name and an idea, press **Add**, and the idea shows up in the list.

Then ask for a change:

> Add an About screen.

The agent calls `update_app`. The open screen changes at once, and the gift ideas you typed are still there. That is the part that surprises people: an update is a new version of the same app, and the data people entered stays.

Finally ask "What did you change?" The agent calls `app_activity` and answers from the log, with lines such as `added screen 'about'`.

You never have to read the spec. If you want to, read on.

## What the spec looks like

This is the spec for the gift ideas app. A form adds an idea, and a list shows the ideas.

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

Three parts matter. `data` says what the app remembers. `screens` says what people see. `actions` says what happens when they press a button. Every action has a description, which is how an agent knows what it does without guessing.

Spec apps render as labelled screens on both an Android style and an iOS style (`style` is `"android"` by default, or `"ios"`). The same app runs on both. For charts, boards, calendars, maps and data sources, see [spec blocks](/docs/spec-blocks/). Five complete examples are in the [spec gallery](https://github.com/shipvo/shipvo/tree/main/packages/spec/gallery): habit tracker, workout log, expense splitter, trip checklist and flashcards.

## Mistakes come back with the fix

A spec is checked before anything is installed. A failed try leaves the phone as it was, and the agent gets a list of problems it can fix on its own.

You can run the same check yourself:

```bash
npm install @shipvo/spec
```

```js
import { readFileSync } from "node:fs";
import { validate } from "@shipvo/spec";

console.log(validate(JSON.parse(readFileSync("gift-ideas.json", "utf8"))));
```

For the spec above the output is:

```
{ errors: [], warnings: [] }
```

We ran that on 10 November 2026 against [`@shipvo/spec`](https://github.com/shipvo/shipvo/tree/main/packages/spec) built from this repository. Then we added a button with no label. The result:

```json
{
  "errors": [
    {
      "path": "$.screens[0].body[2]",
      "message": "Interactive block \"button\" has no label.",
      "fix": "Add \"label\": a short name that people and agents see, for example \"Add goal\"."
    }
  ],
  "warnings": []
}
```

And a list that reads from a name that does not exist (`{{ ideaz }}` instead of `{{ ideas }}`):

```json
{
  "errors": [
    {
      "path": "$.screens[0].body[1].from",
      "message": "Unknown name \"ideaz\".",
      "fix": "Did you mean \"ideas\"?"
    }
  ],
  "warnings": []
}
```

Each problem has a place (`path`) and a fix. That is written for a model to act on. It reads the error, edits the spec and tries again, usually without you noticing.

## The tools, for developers

If you build with an agent in code, these are the MCP tools behind the steps above.

| Tool | What it does |
| --- | --- |
| `create_app` | Checks the spec, installs the app and opens it. `open: false` stays on the current screen. |
| `update_app` | Replaces the spec as a new version of the same app. Data people entered stays. |
| `run_app_action` | Runs one action by name, as its form would. |
| `refresh_app` | Fetches the app's `http` data sources now. |
| `app_activity` | Versions with plain change lines, data sources and events. |
| `export_phone_apps`, `import_phone_apps` | Copy spec apps, with their data and layout, to another phone. |

Every call is logged in `device_log`, so you can see what the agent did. The `id` you pass to `create_app` uses lowercase letters, digits and dashes, up to 40 characters. `gift-ideas` works; `Gift_Ideas` does not, and you get `bad_app_id` back.

Use `export_phone_apps` to copy your apps, with their data and layout, to another phone. The full reference is in [describe an app and it appears](/docs/describe-an-app/) and [phone apps](/docs/phone-apps/).

## Who this is for

**Founders** get something to hold and show. You can test an idea with a customer in minutes, change it while they watch, and decide if it is worth building properly. If you want a guide to what comes after version one, read [how to build a mobile app without coding](/blog/build-a-mobile-app-without-coding/).

**Developers** get a fast sketch. Describe a screen, see it on both platforms, and let your agent test it through the same phone. When the idea is worth keeping, the tools in [your assistant can test your app](/blog/your-assistant-can-test-your-app/) work on it unchanged, because the app has named controls.

## Try it

You can see phones in your browser before you install anything. Open the [playground](/playground/) to see the sample app on an Android phone and an iPhone side by side.

To make your own app, set up your agent with `npx -y @shipvo/cli agents setup`, open a phone, and say what you want. The [getting started guide](/docs/getting-started/) walks through both.

Related: once an app exists, [two assistants can share one phone](/blog/two-ai-assistants-one-phone-assistant-inbox/): one hands the other a task, such as trying to break what was just built.
