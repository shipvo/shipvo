# What MCP is, and why a mobile app might speak it

> The Model Context Protocol lets AI assistants use tools and data in a standard way. What it is, why Shipvo exposes a phone through it, and what a mobile app can offer an agent beyond a screen.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/what-mcp-is-and-why-your-app-might-speak-it/

Until recently, giving an AI assistant access to a system meant a one-off integration for each pair: one connector per assistant, per tool. The Model Context Protocol, MCP, is the attempt to make that a standard.

## What it is

Anthropic introduced MCP on 25 November 2024, calling it "an open standard for connecting AI assistants to the systems where data lives." The problem it describes is that even capable models are "trapped behind information silos and legacy systems," and that each new data source needs its own custom integration, which does not scale. Early adopters named in the announcement included Block and Apollo.

In practice, a tool that speaks MCP publishes a list of things an assistant can do, with names and typed arguments. Any assistant that speaks the protocol can then use them. That is why the same Shipvo server works from Claude, Cursor and ChatGPT's custom connectors.

## Why a phone is a good thing to expose

An assistant that can only read text cannot use a mobile app. Shipvo's MCP server gives it a phone-sized session instead: it opens the app, reads the screen as an accessibility tree with references, and taps, types and scrolls by reference. Everything that happens is on a simulated device, labelled as such.

The tools are few and plain:

- `open_app`, `screen`, `tap`, `type`, `scroll`, `back` and `screenshot` to operate the app
- `set_device` to decide what the phone has: location, permissions, a barcode in view, how a payment ends, whether it is online
- `device_log` and `end_session` to check what actually happened, including what the app sent to its backend

## What an app can offer beyond its screen

The screen is what a customer sees. An app can also offer commands meant for the owner: change a price, read orders, publish. Shipvo's owner API exposes these as typed commands (`owner_describe`, `owner_command`), with an owner token, and audits every change. So an assistant can help run a shop, not only test one.

We are careful about the line here. Today, agents test and demonstrate Shipvo apps. They do not yet buy things for real people through them, which would need consent, spend limits and a checkout contract that does not exist yet.

## Try it

Connecting takes four steps and is in [Test with an assistant](https://shipvo.dev/docs/test-with-an-assistant/). The tools are listed in full in [Agents and Shipvo apps](https://shipvo.dev/docs/agents/#the-tools).

## Sources

- Anthropic, [Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol), 25 November 2024.
- Shipvo, [`@shipvo/mcp`](https://shipvo.dev/docs/mcp/).
