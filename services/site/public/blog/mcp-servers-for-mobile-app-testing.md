# MCP servers for mobile app testing: what exists and what each needs

> AI assistants can now drive a phone through MCP. A look at the local simulator servers, what they require, and the case for a hosted one.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/mcp-servers-for-mobile-app-testing/

The Model Context Protocol lets an AI assistant call tools. Point those tools at a phone and the assistant can open your app, read the screen and tap through it. The interesting question is where the phone comes from.

## Local servers that drive a simulator

The open-source `ios-simulator-mcp` server is a good example. Its documentation describes "an MCP server that enables AI assistants to interact with iOS simulators on macOS," with tools for tapping, typing, swiping, finding elements through the accessibility tree, and capturing screenshots and video.

It is a local tool, and the requirements follow from that: "macOS with Xcode and iOS simulators installed," plus Facebook's `idb` available on your `PATH`. That is a sensible setup for an iOS developer at their desk. It is a harder fit for a Linux CI runner, a teammate without a Mac, or an assistant that lives in a chat window.

## What changes when the server is hosted

A hosted MCP server runs the phone somewhere else. The assistant connects over HTTPS, and the person only supplies a key. That is how Shipvo's simulator works: `shipvo login`, then `shipvo mcp` prints the config for Claude Desktop, Claude Code, Cursor or a ChatGPT custom connector. See [Test your app with an assistant](https://github.com/shipvo/shipvo/blob/main/docs/test-with-an-assistant.md).

Hosting trades control for reach: nothing to install, and it works from any machine. The cost is that your app runs on someone else's infrastructure, and the phone is a simulation. Ours renders your app on the web and simulates the device, so it does not catch native crashes or real hardware behaviour. Everything simulated is labelled `simulated: true`.

## What to look for in any mobile MCP server

1. **How it reads the screen.** An accessibility tree with stable references is more reliable than screenshots and coordinates. It also tests the thing a screen reader user depends on.
2. **Whether it can change the device.** Permissions, connectivity and payment results are where real bugs hide. See [the permission you never test](https://shipvo.dev/blog/the-permission-you-never-test/).
3. **What it returns at the end.** Ours returns what the app actually sent to its backend, which is a better check than the assistant's own report of what it did.
4. **Where it runs.** Local is fine for editing. Hosted is better for CI, sharing and published releases.

## Try it

Run `npx -y @shipvo/cli login`, then `npx -y @shipvo/cli mcp`, and ask your assistant to open the sample app. The [guide](https://github.com/shipvo/shipvo/blob/main/docs/test-with-an-assistant.md) has prompts that find real bugs. For the background, read [what MCP is and why your app might speak it](https://shipvo.dev/blog/what-mcp-is-and-why-your-app-might-speak-it/).

## Sources

- [ios-simulator-mcp](https://docsearch.algolia.com/mcp/docs/repo/joshuayoes/ios-simulator-mcp), project documentation
