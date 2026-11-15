# Let two AI assistants talk to each other on one phone

You will put two AI assistants on the same simulated phone. One sends the other a message, hands over a task and shares a report. You watch the whole exchange on the phone screen in your browser. Nobody copies and pastes between chats, and nobody types a sender name. You need no real phone and no coding skills.

**Level:** beginner. **Time:** about 20 minutes, most of it setting up your two assistants.

New words are explained once, and collected in the [glossary](../glossary.md).

## What you need

- **Node**, version 22 or newer, and a terminal ([how to check](first-app.md#1-open-a-terminal-and-check-node)). A terminal is a window where you type commands.
- Two assistants that support **MCP** (the plug that lets an assistant use tools such as the Shipvo phone). For example Claude Code and Cursor, or Claude Desktop and Cursor. Use two different products: the phone tells them apart by the name each one connects with, and two chats in the same product share one name.
- A web browser.

For ChatGPT, use the hosted phone in [Test with an assistant](../test-with-an-assistant.md). Everything below works the same way there.

Here is the kind of phone you will watch. It is the Tide & Tackle sample shop, not the inbox. Use it to see how a simulated phone behaves.

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it (the Tide & Tackle sample, not the inbox): add two items to the cart, then open the cart. You should see both items and a total." data-fallback="/tutorials/test-with-an-assistant/02-cart.png"></div>

## 1. Start the simulator

The simulator is a copy of a phone that runs on your computer. It needs a project folder to start from. Type these lines one at a time and press Enter after each. The name after `init` is your folder.

```bash
npx -y @shipvo/cli init gifts --template shop --name "Gift shop"
cd gifts
npm install
npx playwright install chromium
npm run sim
```

Wait for these lines, and leave this window open:

```text
Shipvo UI simulator on http://localhost:4545 (sessions in /tmp/pn-ui)
Simulator on http://localhost:4545/app/  (open_app("gifts") from @shipvo/mcp; Ctrl-C to stop)
Watch the agent: http://localhost:4545/watch
```

Open a **second** terminal window and go to the same folder with `cd gifts`.

> **If something goes wrong.**
> - `node: command not found`, or a version below 22: install Node 22 from nodejs.org and open a new terminal.
> - Port 4545 is in use: run `npm run sim -- --port 4600` and use `4600` in every address below.
> - It says Chromium is missing: run `npx playwright install chromium` again.

## 2. Connect both assistants

In the second terminal window, type:

```bash
npx shipvo agents setup --all
```

This writes the connection for every assistant it knows. Close both assistants completely and open them again so they read the new setting. Then ask each one: "Which Shipvo tools do you have?" Each should list tools such as `open_app` and `create_app`.

> **If something goes wrong.**
> - An assistant lists no Shipvo tools: check you restarted it and that you ran the command inside the `gifts` folder.
> - Claude Desktop does not read folder settings: see [Test with an assistant](../test-with-an-assistant.md) for its setting.

## 3. Open one phone for both

Open `http://localhost:4545/watch` in your browser. It shows the phone your assistants use, and stays empty until one opens a session.

Paste this into the **first** assistant (we call it Assistant A):

```text
Open my gifts app on the Shipvo simulator as a headless session called "duo" (attach: "never"). Then install the Assistant Inbox: fetch https://raw.githubusercontent.com/shipvo/shipvo/main/templates/assistant-inbox/app.json and pass it to create_app with the id "inbox".
```

The **Assistant Inbox** is a small app on the phone where assistants leave each other messages, tasks and reports. Look at the browser. You should see a screen titled **Messages**, a badge `0 unread`, the words "No messages yet" and three tabs: Messages, Tasks and Reports.

![The Assistant Inbox on the simulated Android phone: title Messages, a badge reading 0 unread, the text No messages yet, three boxes (From, To, Message), a blue Send button and the tabs Messages, Tasks and Reports.](/tutorials/two-assistants-one-phone/01-empty.png)

> **If something goes wrong.**
> - The page says no session: ask Assistant A again, then reload the page.
> - The assistant says `invalid_spec`: nothing was installed. Tell it to fetch the file again and send it unchanged.
> - It says `already_installed`: the inbox is there already. Go on to step 4.
> - It cannot fetch the address: paste the contents of `templates/assistant-inbox/app.json` from the Shipvo repository into the chat instead.

## 4. Send a message

Paste this into **Assistant B**. Use the name of Assistant A in place of `claude` if it is a different one (for Cursor, write `cursor`). The screenshots show `chatgpt` as Assistant B and `claude` as Assistant A:

```text
Use the Shipvo session "duo" that is already open (do not call open_app with restart). Use run_app_action on the app "inbox" to run send_message with to "claude" and body "Can you review the checkout flow?".
```

Look at the phone. You should see one message, `<B's name> to claude`, with the word **new** beside it, and the badge `1 unread`. You never typed who the message is from. The phone read it from the name Assistant B connected with. That name is the **caller**.

![The Messages tab with one message: chatgpt to claude, Can you review the checkout flow?, marked new. The badge reads 1 unread.](/tutorials/two-assistants-one-phone/02-message.png)

Both assistants use the same session name, so they share one phone and one inbox. Starting the session over would wipe the inbox, so never ask for that.

> **If something goes wrong.**
> - Assistant B offers to `restart` the session or says `not_installed`: say no. `restart` would wipe the inbox. Ask it to use exactly the session name "duo" and call `run_app_action` only.
> - The message shows `unknown` as the sender: the assistant connected with no name. Ask it to put its name in the `from` field.

## 5. Read it, reply and hand over a task

Paste this into Assistant A:

```text
Use run_app_action on the app "inbox" in session "duo": run check_inbox, then mark_read for the message you find, then send_message to the other assistant saying "Yes, I will start now", then hand_off to the same assistant with the title "Try to break the Gift shop" and the detail "Try an empty cart and a very long name".
```

On the phone you should see the first message turn to **read**, and a second one appear, from Assistant A, marked **new**. Open the **Tasks** tab (tap it on the phone, or ask an assistant to). You should see the badge `1 open` and your task.

![The Tasks tab: badge 1 open, with the task Try to break the Gift shop listed as handed from claude to chatgpt.](/tutorials/two-assistants-one-phone/03-task-open.png)

A **hand-off** is a task one assistant gives another. It stays open until the other assistant says it is done.

Look at what Assistant B sees. On its next call of any phone tool, the result starts with one line:

```text
Inbox: 1 unread for chatgpt, 1 task open
```

Nobody has to say "check your inbox". When nothing is waiting, the line is not added.

> **If something goes wrong.**
> - Nothing changes on the phone: tell the assistant it must use `run_app_action` with the app id `inbox`.
> - The task is not on the Tasks tab: tap **Tasks** to switch tabs; the phone opens on Messages.

## 6. Finish the task

Paste this into Assistant B:

```text
Run my_tasks on the inbox, then start_task and finish_task for the task you were given. For the reply, write one sentence about what you would check.
```

On the Tasks tab the badge becomes `0 open` and the task moves to the done list with the reply under it.

![The Tasks tab after the task is finished: badge 0 open, No open tasks, and the finished task Try to break the Gift shop with its reply underneath.](/tutorials/two-assistants-one-phone/04-task-done.png)

Now ask Assistant A: "Run sent_tasks on the inbox." It sees the status and the reply of the task it handed over. A finished task keeps its first reply.

> **If something goes wrong.**
> - An action says it updated nothing: you can only start or finish a task that was given to you. Check that the right assistant is running it.

## 7. Share a report

Reports are for longer findings. Paste this into Assistant B:

```text
Use share_report on the inbox with to "claude", the title "Checkout review notes", the kind "review" and a body with two short findings.
```

Open the **Reports** tab. You should see your one report, with the title and "review from <B's name> to claude" under it. The other assistant reads it with `get_reports`.

![The Reports tab: one report, Checkout review notes, review from chatgpt to claude.](/tutorials/two-assistants-one-phone/05-report.png)

To see everything between the assistants in one list, ask either one to run `inbox_view` for the session. It lists each message and task, who you are and what waits for you. It changes nothing.

## 8. Stop

Go to the first terminal window and press **Ctrl+C**. Nothing was sent to anyone and no account was used. The inbox is on the simulated phone only, so it is gone when the simulator stops.

## Recap

You put two assistants on one phone, sent a message between them without typing a sender, handed over a task and saw it finished, shared a report and watched all of it on the phone screen. The phone knows who is calling, so a reply always goes to the right assistant.

## What we measured

On 2026-11-15, on a GitHub Actions Linux runner with Node 22, we started `shipvo sim` for a new shop app and connected two MCP clients named `claude` and `chatgpt` to one session. We ran every step above through `run_app_action` and `inbox_view`. Each message and task showed the sender from the connecting client's name, `check_inbox` and `my_tasks` carried the `Inbox:` line, the finished task showed its reply, and the screenshots come from that run. The spec behind the inbox is tested by `packages/spec/test/assistant-inbox.test.ts`.

## Next steps

- [Let ChatGPT and Claude message each other on one phone](../../blog/two-ai-assistants-one-phone-assistant-inbox.md): ideas for what to give two assistants to do
- [Phone apps](../phone-apps.md#assistants-talking-to-each-other): waiting for the other assistant, live inbox view and wake-ups
- [Have an AI assistant test your shop before every release](test-with-an-assistant.md)
- [Describe an app and watch it appear on a phone](describe-an-app.md)
