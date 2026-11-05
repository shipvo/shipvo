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

## Direction from the owner (November 2026)

This section is set by the owner. The Head of Product plans from it and does not change it.

**The lane.** Shipvo is the release control plane for mobile apps, for people and for AI agents: what reaches users' phones, who approved it, how it is measured and how fast it is undone. Builds stay with the tools teams already use: EAS Build for React Native and Expo, and a team's own CI for everything else. Store submission of any binary goes through EAS Submit, which accepts any correctly signed `.ipa` or `.aab` built anywhere ([Expo docs](https://docs.expo.dev/eas/submit/introduction/)). Shipvo does everything around the binary: updates, testing, store setup, release health, rollback, governance.

**Five advantages to compound, every month:**
1. Trust: a public record of signed releases, automatic rollbacks, measured parity and open code.
2. The standard: Shipvo's signed release format and agent tools published as an open spec, so other tools plug into Shipvo.
3. Distribution through agents and AI app builders: our MCP is the way agents ship and test mobile apps.
4. Cost: self-hosted on Cloudflare, an order of magnitude cheaper than metered OTA at scale.
5. Speed: the autonomous team ships every day, under the merge contract, with the evidence public.

**Three stages:**
1. Now to 3 months: win founders and small teams (adopt mode, browser preview with native features, the store path, release health, agent safety). Proof: 1,000 apps live with real weekly healthy releases.
2. 3 to 9 months: enterprise-ready. Audit log of every release and agent action, approvals (an agent proposes, a person approves), release policy as code, single sign-on and roles, private and on-premises deployment, long-term-support releases, SOC 2 and published security documents. And frameworks beyond React Native (below).
3. 9 to 24 months: the standard. The open spec adopted by others, partner integrations, the package ecosystem, and governance of AI changes to mobile apps for large companies.

**Frameworks.** The core (signing, pointers, cohorts, rollback, health, agents, store setup) does not depend on a framework. Each framework gets an adapter with three parts: a runtime (verify, stage, apply, roll back), a build path (EAS Build for React Native and Expo; the team's own CI for others, with a Shipvo template), and submission through EAS Submit. Order: React Native and Expo (done), then Capacitor and Cordova (their updates are web bundles, and their apps already run in our simulator almost as on a phone), then others when users ask. Apps are never converted from one framework to another: Shipvo meets teams where they are.

**Risks to watch:** Apple and Google rules on updates (stay on interpreted code and declared capabilities, and document compliance publicly); trust in AI-written code (the merge contract and test evidence are the answer, never hidden); and adoption (only real users prove anything).
