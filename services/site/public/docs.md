# Shipvo documentation

> Every docs page is also available as Markdown at `/docs/<page>.md`. Everything in one file: https://shipvo.dev/llms-full.txt

## Get started

- [What Shipvo is](https://shipvo.dev/docs/overview.md): One React Native app, two places it runs: phones and AI agents.
- [Build your first app](https://shipvo.dev/docs/getting-started.md): Twenty minutes from nothing to an app agents can open and phones update over the air.
- [Moving to a new machine](https://shipvo.dev/docs/new-machine.md): Back up and restore your signing seed, sign in again, keep publishing.
- [Self-host the control plane](https://shipvo.dev/docs/self-hosting.md): Run your own on Cloudflare in ten minutes.

## Agents

- [Agents and Shipvo apps](https://shipvo.dev/docs/agents.md): How an agent sees and operates an app, the MCP tools, hosted access and public listings.
- [@shipvo/mcp](https://shipvo.dev/docs/mcp.md): The MCP server: local over stdio, remote over HTTP, hosted with a key.

## Reference

- [Device API](https://shipvo.dev/docs/device-api.md): Camera, location, biometrics, payments, notifications: one API, real on phones, simulated for agents.
- [@shipvo/cli](https://shipvo.dev/docs/cli.md): init, sim, login, app, publish, rollback, keys.
- [@shipvo/runtime](https://shipvo.dev/docs/runtime.md): The over-the-air runtime and the Expo config plugin.
- [@shipvo/device](https://shipvo.dev/docs/device.md): The device package and its simulator shims.
- [@shipvo/sim](https://shipvo.dev/docs/sim.md): The UI simulator: Playwright, accessibility trees, the simulated phone.
- [@shipvo/schema](https://shipvo.dev/docs/schema.md): Release pointers, envelopes and manifests, as zod schemas.

## Measured results

- [Simulator vs device parity](https://shipvo.dev/docs/parity-results.md): Every screen compared on Android and iOS, gaps included.
- [OTA on a 2 GB phone](https://shipvo.dev/docs/spike-results.md): Update sizes and timings on a Redmi 9A.
- [Agent gate results](https://shipvo.dev/docs/agent-gate-results.md): Agents scored by what the backend received.
