# Shipvo as a platform

Set by the owner. The Head of Product plans against this and may refine it through pull requests; the mission does not change without the owner.

## Mission

Make building, testing and maintaining mobile apps easy and accessible to everyone, from senior engineers to non-technical founders working with an AI agent.

## Shipvo is infrastructure, not a single product

Shipvo is a platform: a small, dependable core that many products, packages and services are built on, the way Expo is a set of packages, services and tools around React Native. Every new capability should plug into the core instead of becoming a separate island.

**The core (keep it small, safe and stable):**
- the native shell and runtime (signed over-the-air updates, staged rollout, rollback),
- the app manifest and schema (`@shipvo/schema`): the single description of an app that every other part reads,
- the control plane (apps, keys, releases, cohorts, telemetry),
- the simulator (an app any agent or test can open without a phone).

**Products and packages on top (the platform grows here):**

| Layer | Exists today | Directions to explore |
| --- | --- | --- |
| Ship | `@shipvo/cli`, `@shipvo/runtime` | release dashboard, crash-rate auto-rollback, update channels, Docker self-hosting |
| Simulate and test | `@shipvo/sim`, `@shipvo/mcp`, `@shipvo/test` | visual regression, network mocking, test recording from an agent session, device farm bridge |
| Device | `@shipvo/device` | more capabilities (contacts, calendar, files, deep links, push), each with real/simulated/unavailable levels |
| Manage | per-app `/admin` | content and screens editable without code, roles, approvals, audit log |
| Build | `shipvo init` templates | templates for common app types (shop, booking, content, community), a screen and theme generator from the design skill |
| Grow | marketplace on shipvo.dev | analytics, in-app messages, feature flags, A/B tests on cohorts |
| Agents | MCP server, owner API | an "app owner agent" that runs the store, answers users and ships fixes; plug-ins for PiPilot, Claude, Cursor |

**Non-technical founders** are a first-class audience: they should be able to describe an app to an agent, see it running in the simulator, change content in `/admin`, and publish an update, without touching a terminal. Every bet should ask: does this also work for them?

## How new packages are added

1. The Head of Product opens an issue labelled `new-package` and `epic` with: the user and job, why it belongs in Shipvo, the proposed name (`@shipvo/<name>`), its public API sketch, how it plugs into the core (manifest, control plane, simulator or MCP), and the first slice.
2. The first slice creates the package following "Adding a package" in `CLAUDE.md`.
3. The daily release train publishes it to npm automatically once it has code and tests on a green `main`.
