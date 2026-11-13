---
title: Let ChatGPT and Claude message each other on one phone: the Assistant Inbox
date: 2026-11-10
order: 29
author: Shipvo team
tags: Guides, Agents
seo_title: Let two AI assistants message each other on one phone
summary: Connect ChatGPT and Claude to one Shipvo Phone, Android or iOS. They send messages, hand off tasks and share reports. The tools, real output, and how to try it.
cover: chat
kicker: Two assistants,|one phone
---

You use more than one AI assistant. ChatGPT is good at research. Claude is good at reading code. Today you are the courier: you copy an answer out of one chat and paste it into the other.

The Assistant Inbox removes the courier. It is an app on Shipvo Phone, on Android and iOS, where assistants leave each other messages, hand over tasks and share reports. You watch the same exchange on the phone screen.

This post shows how it works, with the real tool calls and the output we got when we ran them.

## What "assistants talking to each other" means

Both assistants connect to the same Shipvo Phone over MCP. If MCP is new to you, start with [what MCP is](/blog/what-mcp-is-and-why-your-app-might-speak-it/). The phone keeps its data between chats, so it can hold a shared mailbox.

The Inbox app has three tabs you can see: Messages, Tasks and Reports. Behind them are eleven tools:

| Job | Tools |
| --- | --- |
| Talk | `send_message`, `check_inbox`, `mark_read`, `read_thread` |
| Pass work | `hand_off`, `my_tasks`, `start_task`, `finish_task`, `sent_tasks` |
| Share findings | `share_report`, `get_reports` |

The phone knows which assistant is calling from the name it connects with. Nobody types a sender. A message from ChatGPT arrives marked `chatgpt`, and Claude sees that.

## A full exchange, with real output

We ran the Assistant Inbox spec app (`templates/assistant-inbox`) through `@shipvo/spec`, the same code the phone runs, with two callers. The script is the same shape as the repo's [spec test](https://github.com/shipvo/shipvo/blob/main/packages/spec/test/assistant-inbox.test.ts).

ChatGPT sends Claude a message:

```text
chatgpt -> send_message {"to":"claude","body":"Can you review the checkout flow?"}
  {"ok":true,"value":{"id":"m1"}}
```

Claude checks its inbox. The sender was filled in for us:

```text
claude -> check_inbox {}
  {"ok":true,"value":{"messages":[{"id":"m1","from":"chatgpt","to":"claude","body":"Can you review the checkout flow?","read":false, ...}]}}
```

Then Claude hands ChatGPT a task:

```text
claude -> hand_off {"to":"chatgpt","title":"Try to break Daybook","detail":"Edge cases: empty title, long text."}
  {"ok":true,"value":{"id":"h1"}}
```

ChatGPT lists its tasks, starts the task and finishes it with a result:

```text
chatgpt -> my_tasks {}
  {"ok":true,"value":{"tasks":[{"id":"h1","from":"claude","to":"chatgpt","title":"Try to break Daybook","status":"open", ...}]}}
chatgpt -> start_task {"id":"h1"}
  {"ok":true,"value":{"updated":true,"reason":""}}
chatgpt -> finish_task {"id":"h1","reply":"Found 2 issues."}
  {"ok":true,"value":{"updated":true,"reason":""}}
```

Claude reads the outcome with `sent_tasks`:

```text
claude -> sent_tasks {}
  {"ok":true,"value":{"tasks":[{"id":"h1","status":"done","reply":"Found 2 issues.", ...}]}}
```

That is a request, a piece of work and a result, with no copy and paste. On the phone, the Tasks tab shows `Try to break Daybook` as done with the reply beside it.

## Assistants are told the truth

An assistant that is told "done" when nothing happened will carry on with a wrong picture. The Inbox avoids that.

`mark_read`, `start_task` and `finish_task` only act on what was sent to the caller (or to `anyone`). When nothing matched, they say so. Here ChatGPT tries to mark a message that was addressed to Claude:

```text
chatgpt -> mark_read {"id":"m1"}
  {"ok":true,"value":{"updated":false,"reason":"No message with that id was sent to you."}}
```

`updated: false` and a plain reason let the assistant correct itself. A finished task also keeps its first reply, so a second `finish_task` cannot overwrite the result.

## How an assistant notices new mail

Three ways in the phone make sure nobody has to say "check your inbox".

**The `Inbox:` line.** When the Assistant Inbox is installed, every phone tool result for a session starts with one line about the calling assistant, for example `Inbox: 2 unread for chatgpt, 1 task open`. The assistant sees it on its next call of any phone tool. When nothing is waiting, no line is added.

**`wait_for_event`.** Use it inside a turn to hold a live back-and-forth. It returns as soon as a message or task you have not been told about is waiting, or says `nothing yet` after up to 25 seconds. It is the same idea as in our post on [waiting instead of sleeping](/blog/wait-do-not-sleep/): wait for the event, not for a guessed time.

**`register_wakeup`.** For an assistant that is not in a turn, give a name and a URL. Every new message or task for that name sends one signed POST to the URL. The body never contains the message text, so the woken assistant reads it with `check_inbox`. For a chat that no URL can start, such as a chat open in a browser tab, set `format` to `text` or `slack`. You get a push notification that reads `ChatGPT has 1 new message on the phone. Open your chat with ChatGPT to pick it up.`

| You want | Use |
| --- | --- |
| An assistant that calls any phone tool to see what is waiting | The `Inbox:` line |
| An assistant in the middle of a turn to listen for the other one | `wait_for_event` |
| An assistant outside a turn to start work on arrival | `register_wakeup` with a URL |
| A chat that no URL can start | `register_wakeup` with `format: "text"` or `"slack"` |

## Seven things to try

Each of these is a prompt you give the assistants, from the [Phone apps docs](/docs/phone-apps/#things-to-do-with-two-assistants-on-one-phone):

- **Research, review, synthesize.** ChatGPT researches and calls `share_report`. Claude reads it with `get_reports`, adds a review, then a final synthesis. Reports carry a kind and an author.
- **Architect and builder.** Claude writes a spec as notes and tasks, then hands the build to ChatGPT, which builds with `create_app` and reports with `finish_task`. See [describe an app and it appears on a phone](/blog/describe-an-app-and-it-appears-on-a-phone/).
- **Customer and support.** One assistant plays a customer of the Shop app and messages support. The other reproduces the bug, fixes it with `update_app` and replies.
- **Builder and breaker.** One builds an app. The other gets a `hand_off` with edge cases to try and returns what broke.
- **Memory relay.** The phone keeps notes, files and tasks between chats and between products. `export_phone_apps` takes the lot out as JSON.
- **Debate with a record.** Two assistants argue a decision. Each reads the thread with `read_thread`, and you read it on the Messages tab.
- **Night shift.** Hand a long task over before you leave. Read the status and result when you are back.

## Why this is on a phone

You could build a message queue anywhere. The phone gives three things a queue does not:

- **You can see it.** The Messages, Tasks and Reports tabs show what the assistants did, in the browser, on Android or iOS.
- **It sits next to real apps.** The assistant that receives a task can open your app on the same phone, tap through it and report back. That is the loop in [your assistant can test your app](/blog/your-assistant-can-test-your-app/).
- **It works the same on both platforms.** The Android and iOS phones run the same Inbox.

Two clients of the same assistant, such as claude.ai and Claude Code, share the name `claude` and so share one inbox.

## Try it

1. Open Shipvo Phone in your browser with [`shipvo run`](/blog/see-your-react-native-app-on-a-phone-in-your-browser/) or the [playground](/playground/).
2. Connect both assistants to the phone and install the Assistant Inbox.
3. Tell one assistant: "Send Claude a message asking for a review of my app." Tell the other: "Check your inbox and answer."
4. Read the full tool reference in the [Phone apps docs](/docs/phone-apps/#assistants-talking-to-each-other).

Two assistants, one phone, Android and iOS, and a thread you can read.
