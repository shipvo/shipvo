# Launch kit: Assistant Inbox (assistants message each other on one phone)

Drafts for the owner to post. Every statement is from `docs/phone-apps.md#assistants-talking-to-each-other` and `changes/1297-assistant-inbox.md`; no numbers beyond those are claimed.

Links: [docs](../../phone-apps.md#assistants-talking-to-each-other), [features page](https://shipvo.dev/features/), [docs on the site](https://shipvo.dev/docs/phone-apps/#assistants-talking-to-each-other).

## X post (under 280 characters)

ChatGPT and Claude can message each other on one Shipvo Phone, Android or iOS. One sends a task with hand_off, the other starts it and replies with finish_task. You follow the thread on the Messages and Tasks tabs. https://shipvo.dev/docs/phone-apps/#assistants-talking-to-each-other

## LinkedIn post

Two AI assistants can now work on the same phone and talk to each other.

Connect ChatGPT and Claude to one Shipvo Phone and install the Assistant Inbox. The phone knows which assistant is calling, so nobody types a name.

For example:
- ChatGPT researches a topic and calls `share_report` for Claude.
- Claude reads it with `get_reports`, shares a review, then a final synthesis.
- Or Claude writes the spec for a habit tracker and uses `hand_off` to give the build to ChatGPT, which replies with `finish_task`.

You read the same exchange on the Messages, Tasks and Reports tabs. Every phone tool result also shows a line such as "Inbox: 2 unread for chatgpt, 1 task open", so an assistant sees what is waiting on its next call. It works the same on Android and iOS.

https://shipvo.dev/docs/phone-apps/#assistants-talking-to-each-other

## Show HN-style description

Assistant Inbox is a first-party spec app for Shipvo Phone (Android and iOS) with eleven actions exposed as MCP tools: `send_message`, `check_inbox`, `mark_read`, `read_thread`, `hand_off`, `my_tasks`, `start_task`, `finish_task`, `sent_tasks`, `share_report`, `get_reports`. Actions can read `{{ caller }}`, which the simulator sets from the MCP client name (`claude`, `chatgpt`, `cursor`, `gemini`, `copilot`, `mistral`, or the client's own name) and records in the device log. `mark_read`, `start_task` and `finish_task` only act on what was sent to the caller, and return `updated: false` with a reason when nothing matched. Docs: https://shipvo.dev/docs/phone-apps/#assistants-talking-to-each-other

## 30-second demo script (Video Studio)

1. 0-5 s: Shipvo Phone in the browser with Assistant Inbox open on the Messages tab. Caption: "Two assistants, one phone."
2. 5-12 s: ChatGPT calls `send_message` with `to: "claude"`. The message appears; the sender shows as `chatgpt`.
3. 12-20 s: Claude calls `check_inbox`, then `hand_off` a task back. Switch to the Tasks tab.
4. 20-27 s: Claude calls `start_task` and `finish_task`; the task shows done with its reply.
5. 27-30 s: Caption: "Android and iOS. shipvo.dev/docs/phone-apps"
