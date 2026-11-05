# Have an AI assistant test your shop before every release

<video controls preload="metadata" playsinline tabindex="0" data-title="Have an AI assistant test your shop before every release" data-length="1 min 30 s" poster="/videos/test-with-an-assistant.jpg" src="/media/videos/test-with-an-assistant-e368a4d3.mp4"><track kind="captions" src="/videos/test-with-an-assistant.vtt" srclang="en" label="English">Your browser cannot play this video. Read the captions and transcript on the Videos page.</video>

Prefer to watch first? This 1 minute 30 second video covers the same steps. [Captions and transcript](../videos.md).

Music: "Thrilled hands holding" by Tymphony (Jamendo, CC BY-SA 3.0) https://www.jamendo.com/track/341563

You will connect an assistant (Claude, ChatGPT-style tools, Cursor) to a shop app on your computer, ask it to shop like a customer, check a declined payment and a good payment, turn what it did into a test that runs by itself, and run that test before a release. You need no phone and you do not write code.

**Level:** beginner. **Time:** the commands run in about two minutes on our test machine, and the assistant's shopping run took 4 seconds (see "What we measured"). Allow 20 minutes the first time to set up the assistant. If you have not made an app yet, do [Make a shop with your own products](your-own-shop.md) first. This page starts from the shop it makes.

New words are explained once, and collected in the [glossary](../glossary.md).

## What you need

- The shop from [your own shop](your-own-shop.md), in a folder called `sandbar` (use your own folder name where you see it). A new one takes one command, in step 1.
- Node 22 or newer and a terminal ([how to check](first-app.md#1-open-a-terminal-and-check-node)).
- An assistant that supports **MCP**: Claude Desktop, Claude Code or Cursor. MCP is the plug that lets an assistant use tools. ChatGPT needs the hosted simulator, which is a different setup: see [Test with an assistant](../test-with-an-assistant.md).

## 1. Get the shop and start the simulator

Skip this if you already have your shop running. Otherwise:

```bash
npx -y @shipvo/cli init sandbar --template shop --name "Sandbar Shop"
cd sandbar
npm install
npx playwright install chromium
npm run sim
```

Wait for `Simulator on http://localhost:4545/app/` and leave this window open. Open a **second** terminal window and go to the same folder (`cd sandbar`) for the later steps.

You should see your shop at `http://localhost:4545/app/`. Try it yourself before the assistant does:

<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: add two items to the cart, then open the cart. You should see both items and a total." data-fallback="/tutorials/test-with-an-assistant/02-cart.png"></div>

![The shop cart on a 390 by 844 phone: Canvas tote x 1 and Enamel mug x 1, each with a Remove button, then "Total: $30.00" and a teal Pay button.](/tutorials/test-with-an-assistant/02-cart.png)

This phone shows the finished sample shop, not your own. The picture shows your starter shop with two items in the cart.

> **If something goes wrong.** `address already in use` means the simulator is already running in another window. Close that window and run `npm run sim` again. If a check fails, run `npx shipvo doctor` and follow the line that starts with `FAIL`.

## 2. Connect your assistant

Your assistant needs one setting. It tells the assistant to start the Shipvo tools and use the simulator you started.

- **Claude Desktop:** open Settings, then Developer, then Edit Config. Paste the block below into the file it opens and save.
- **Claude Code:** in the `sandbar` folder, run `claude mcp add shipvo -- npx -y @shipvo/mcp`.
- **Cursor:** open Settings, then MCP, then Add new server, and paste the block below.

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

Restart the assistant. Then type this to it, as a normal message:

```text
Open the Shipvo app "sandbar" and tell me what is on the first screen.
```

You should hear that it opened "Sandbar Shop" and sees a Cart button and five products: Canvas tote, Enamel mug, Pocket notebook, Wool beanie and Steel bottle. Behind the scenes it called the `open_app` tool. It reads the screen as a list of buttons and headings (an **accessibility tree**), the way a screen reader does. It never sees colours or pixels.

> **If something goes wrong.**
> - The assistant says it has no Shipvo tools: check that you restarted it after saving the setting, and that the simulator from step 1 is still running.
> - It says it cannot reach the simulator: the simulator window was closed. Start it again with `npm run sim`.
> - It says `sandbar` is not an app: the app id is the folder name you gave to `init`. Ask it to run `list_apps` and use the name it prints.

## 3. Ask it to shop like a customer

Customers do the obvious thing and get stuck where the screen is unclear. Assistants do the same. Send this:

```text
In the Shipvo app "sandbar": buy the Canvas tote. First make the payment fail and tell me
what the screen says. Then make the payment succeed and tell me what the screen says.
Name every screen you saw, and tell me anything that confused you.
```

The assistant taps the tote, adds it to the cart, opens the cart and pays. It uses `set_device` to choose whether the next payment is approved or declined, because nothing here is a real payment. In our run the failed payment showed **Payment failed: declined** with the tote still in the cart, and the good payment showed **Your cart is empty** and **Order placed**.

![The shop after a successful payment: the cart says "Your cart is empty", "Total: $0.00" and "Order placed".](/tutorials/test-with-an-assistant/03-order-placed.png)

The screen says "Paying..." first and the result a moment later ([we are fixing that](https://github.com/shipvo/shipvo/issues/463)). If your assistant reports "Paying..." as the result, tell it: "Use the `settle` option on tap, or call screen again, and tell me the final result."

> **If something goes wrong.** If the assistant taps the wrong thing, say what is on the screen and what you wanted. It can always ask for the screen again. If it says a tool call timed out, check that the simulator window is still open.

## 4. Ask it to check what really happened

An assistant can say "the payment worked" when it did not. Ask for proof:

```text
Now call device_log and show me every device event. Was the payment sent to the right shop
name and the right amount? Quote the log, do not summarise it.
```

`device_log` is the list of everything the app asked the phone to do, with the label `simulated: true` on every line. For the declined payment you should see `"amount": 18`, `"currency": "USD"` and `"reason": "declined"`. You will also see `"to": "My Shop"`. Your shop is called "Sandbar Shop", so this is a real mistake the assistant caught: the starter shop has the name "My Shop" written into its payment code ([we filed it as #461](https://github.com/shipvo/shipvo/issues/461)). Open `src/screens/Cart.tsx`, find `to: "My Shop"` and write your own shop name between the quote marks. Save, wait for `rebuilt in` in the simulator window if it was started with `npx shipvo sim --watch`, and ask the assistant to run step 3 again.

This is the point of the exercise: you do not need to know what to look for. You tell the assistant what a good result is, and it checks.

> **If something goes wrong.** If the assistant answers from memory and shows no log lines, say: "Call the tool again and paste its output." The simulator labels everything it pretends to do, so a log that says `simulated: true` is the real log.

## 5. Turn its run into a test

A test is a small file that repeats the same steps and fails when the result changes. It runs on your computer in seconds and never gets tired. Ask:

```text
Call export_test for that session and show me the script.
```

You get a script like this. Save it as `tests/checkout.test.ts` in your `sandbar` folder:

```ts
import { test } from "@shipvo/test/vitest";
import { openApp } from "@shipvo/test";

test("recorded session for sandbar", async () => {
  const phone = await openApp({ app: "sandbar" });
  await phone.tap("Canvas tote");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
  await phone.tap("Add to cart");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
  await phone.tap("Cart");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
  await phone.device.set({"payment":{"nextResult":"decline"}});
  await phone.tap("Pay");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
  await phone.device.set({"payment":{"nextResult":"approve"}});
  await phone.tap("Pay");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
});
```

Each `TODO` line only waits for any text. Replace each with the words that should appear, so the test checks something. These are the words from steps 3 and 4:

| After this line | Replace `/\S/` with |
| --- | --- |
| `tap("Canvas tote")` | `"$18.00"` |
| `tap("Cart")` | `"Total: $18.00"` |
| the first `tap("Pay")` | `"Payment failed: declined"` |
| the second `tap("Pay")` | `"Order placed"` |

Leave the other `waitFor` lines as they are. Your prices are different from ours if you changed `src/data/products.json`: use what your shop shows. Now run all the tests. The simulator must still be running in the first window.

```bash
npm test
```

You should see `Tests  5 passed (5)`: the four tests that came with your shop and the one you just saved. If you did not change your shop, no screens change and nothing fails.

> **If something goes wrong.**
> - `waitFor` times out: the words in your file do not match the screen. Copy them from what the assistant reported, including the `$` and spacing.
> - `Cannot connect`: start the simulator (step 1) in the other window.
> - A test from the starter fails after you changed product names or prices: the starter tests read `src/data/products.json`, so this usually means a typo there. A missing comma makes the app fail to build; the window running the simulator prints the error.

## 6. Make it a habit before every release

Before you send an update, run the checks in this order. Each command stops the line if it fails:

```bash
npm test && npx shipvo publish --dry-run --skip-web true
```

The test runs first. If it passes, the dry run builds, signs and checks the release without sending it. At the end you should see `Dry run complete. Nothing was sent.` To send the release for real, see [Create your first app](first-app.md#5-check-what-a-release-would-contain) and [Build your first app](../getting-started.md#5-publish-over-the-air).

Then, once a week or when you add a screen, ask the assistant for a fresh look. It is good at the questions you would not think to ask:

```text
Open "sandbar". Turn the network off with set_device, add an item to the cart and pay.
Does the app tell me I am offline, or does it fail without a word?
```

You can also run `npx shipvo explore --sim http://localhost:4545`. It walks every button without an assistant and writes `explore-report.md`. On our shop it found nothing in 26 steps and said it stopped at its depth limit with 5 screens not walked.

## Recap

You:

1. started your shop in the simulator,
2. connected an assistant to it,
3. had it shop, with a failed and a good payment,
4. had it prove what happened with `device_log`, and it found a wrong shop name,
5. turned its run into a test with `export_test` and ran it,
6. ran the test and a practice release together.

## What we measured

On 2026-11-05, on a GitHub Actions Linux runner with Node 22 and packages built from this repository: `npm install` 32 s (from local package files), `npx playwright install chromium` 8 s, simulator start about 9 s. The assistant-style run (10 tool calls through the MCP server, by script, not by a live Claude) took 4 seconds. `npm test` with the five tests took 13 s. `shipvo explore` took 48 s. `shipvo publish --dry-run --skip-web true` took 15 s and made a 1.68 MB release. We did not run a live Claude, ChatGPT or Cursor session for this page: we called the same MCP tools by script and copied their output. Your times depend on your connection.

## Next steps

- Make the shop yours: [Make a shop with your own products](your-own-shop.md).
- See every tool the assistant can call: [Agents and Shipvo apps](../agents.md#the-tools).
- Write tests by hand and run them on every pull request: [Test your app in CI](../testing.md).
- Test an app that is already published, or use ChatGPT: [Test with an assistant](../test-with-an-assistant.md).
