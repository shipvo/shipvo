# Test your app with an assistant

Ask Claude, ChatGPT or Cursor to use your app the way a customer would, and tell you where it breaks. The assistant connects to Shipvo over MCP, opens your app in a simulated phone and works through it screen by screen. There is no emulator to install and no phone to plug in.

This page is the shortest path from nothing to your assistant tapping through your app. For scripted tests that run on every pull request, see [Test your app in CI](testing.md).

## The two ways to connect

| | Local | Remote (hosted) |
| --- | --- | --- |
| Runs on | Your machine (`shipvo sim`) | `sim.shipvo.dev`, one sandbox per key |
| Needs | Node 22, Chromium | A key from `shipvo login` |
| Works with | Claude Desktop, Claude Code, Cursor, PiPilot | The same, plus ChatGPT custom connectors and any client that speaks Streamable HTTP |
| Your app | The build in your working directory | Any app your key can open, including a published release |
| Use it when | You are editing the app and want instant feedback | You want to test a published release, share a key with a teammate, or use ChatGPT |

## Remote: four steps

**1. Sign in once.** This opens GitHub sign-in and stores a test key on your machine.

```bash
npx -y @shipvo/cli login
```

The key opens the beta sample app and every app you register with `shipvo app create`. It comes with a quota of sandbox minutes and expires after 30 days; run `shipvo login` again to renew it, and `shipvo keys` shows the date.

**2. Print the connection details.**

```bash
npx -y @shipvo/cli mcp
```

It prints the exact config for each client, with your key filled in.

**3. Add it to your assistant.**

For Claude Desktop, Claude Code and Cursor, paste the config it printed:

```json
{
  "mcpServers": {
    "shipvo": {
      "url": "https://sim.shipvo.dev/mcp",
      "headers": { "Authorization": "Bearer <your key>" }
    }
  }
}
```

ChatGPT's custom MCP connectors cannot send headers, so the key goes in the path. Add a connector with this URL:

```text
https://sim.shipvo.dev/mcp/<your key>
```

Treat that URL like a password: anyone who has it can use your quota.

**4. Ask it to test.** Start with something small, then get specific.

```text
List the Shipvo apps I can open, then open Tide & Tackle and tell me what is on the first screen.
```

## Prompts that find real bugs

Assistants are good at what a first-time customer does: they read what is on screen, take the obvious path, and get stuck where the screen is unclear. These prompts use that.

```text
Open myshop@latest. Buy the cheapest item with mobile money. Tell me every screen you
saw, and stop and report anything that confused you or did not work.
```

```text
Open myshop@latest. Deny the camera permission when asked, then try to scan a code.
What does the app show? Is there a way forward?
```

```text
Open myshop@latest, then use set_device to take the phone offline. Add an item to the cart.
Does the app say that you are offline, or does it fail silently?
```

```text
Open myshop@latest. Use the fingerprint option but make the payment fail. Confirm that
no order was placed, using end_session at the end.
```

The last prompt works because `end_session` returns what your app actually sent to its backend, not what the assistant believes it did. That is the check to trust. See [Agents and Shipvo apps](agents.md#grading-an-agent).

## Test a release before it reaches phones

Publishing gives every release a number. Ask the assistant to open that exact release:

```text
Open myshop@r13 and run through checkout.
```

`myshop@latest` is the newest published release and `myshop` is your local build. Because the assistant opens the signed bundle that phones will receive, what it tests is what ships.

## What the assistant can and cannot see

It sees the screen as an accessibility tree: roles, names and references such as `button "Place order" [ref=e44]`, the way a screen reader would. It taps by reference and never by coordinates. So if the assistant cannot find your button, a person using a screen reader probably cannot either. Name your buttons.

The simulator is not a phone. It renders your app on the web and simulates the device, so it does not catch native crashes, real camera or GPU behaviour, or slow-phone performance. Everything simulated is labelled: receipts say `SIMULATED-` and `device_log` marks each event `simulated: true`. Keep a short pass on a real device before a store release, and see the [parity results](parity-results.md) for where the simulator and real devices differ.

## Check it works

If the assistant says it has no Shipvo tools, check these in order:

- The key has not expired (`shipvo keys`).
- The URL ends in `/mcp` for header clients and `/mcp/<key>` for ChatGPT.
- You restarted the client after editing its config.
- The app id is one your key can open: ask for `list_apps`.

A sandbox sleeps after 30 idle minutes and wakes on the next call, so a slow first reply after a break is normal. Sessions survive reconnects: `list_sessions` shows what is still open.

## Next

- Write the same flows as typed tests that run on every pull request: [Test your app in CI](testing.md).
- Every tool the assistant can call: [Agents and Shipvo apps](agents.md#the-tools).
- Let any agent open your app: [list it](agents.md#listing-your-app-for-every-agent).
