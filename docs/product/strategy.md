# Shipvo strategy

Owner: Head of Product agent. Reviewed weekly. Last review: 2026-11-04.

## 1. Vision and who we serve first

**Vision.** A React Native team should be able to ship a fix to every phone in under a minute, and trust that a bad release cannot brick the app. An AI agent should be able to open, use and test that same app without a phone. One signed release feeds both.

**Beachhead user.** A small React Native team (1 to 5 developers) that already ships an Expo or bare RN app on both stores, that cannot or does not want to pay per-update fees, and that runs on slow networks and low-end Android phones. They want to self-host on Cloudflare or use the hosted `api.shipvo.dev`. Our own evidence comes from this user: the spike was measured on a 2 GB Xiaomi Redmi 9A on 4G in Douala ([spike results](../spike-results.md)). The second user, who comes after the first, is a developer who wants Claude, ChatGPT or another agent to test their app in CI through MCP.

## 2. Jobs and reasons to choose something else

Jobs:

1. "Fix a production bug now without waiting for store review, and not break anyone's phone."
2. "Roll a change out to a few users first, and undo it fast."
3. "Let an AI agent check my app works before I ship it, without me running emulators."

Why they would still choose something else today:

- **Expo EAS Update** is the default for Expo apps. It has per-update rollout percentages, rollback commands, end-to-end code signing (paid plans only, per DeepWiki on `expo/expo`) and bsdiff patch support. Shipvo has no polished dashboard and a much smaller community.
- **No track record.** We have one sample app in the evidence. No outside team has told us they ship with Shipvo (all 8 issues to date were opened by one account).
- **iOS is new.** The iOS runtime shipped on 2026-10-31. There are no bsdiff patches on iOS yet (#2), and iOS apply time is not yet published (#1).
- **Bytecode safety is half done.** Publish now records the Hermes bytecode version (#10, #12), but shells do not check it yet.
- **Maestro and mobile-mcp** already have users for agent-driven testing on real devices and emulators. Our simulator only covers what the app exposes in React Native Web.

## 3. Metrics

**North-star metric: weekly OTA releases applied and healthy on devices that are not ours.** Not measured yet. How: count distinct app IDs other than `tide-and-tackle` with at least one `healthy` telemetry row per week in the control-plane `telemetry` table. Needs a read-only query script (bet 3).

Input metrics:

| Metric | Current value | Source or how to measure |
| --- | --- | --- |
| npm downloads, last week (2026-10-28 to 2026-11-03) | `@shipvo/mcp` 1,299; `@shipvo/cli` 830; `@shipvo/sim` 602; `@shipvo/device` 592; `@shipvo/runtime` 582; `@shipvo/schema` 474; `@shipvo/test` 238 | `https://api.npmjs.org/downloads/point/last-week/@shipvo/<pkg>`, read 2026-11-04. These include CI installs and mirrors; they are not unique users. |
| Time from first `shipvo init` to first applied OTA | Partial: `init` 68 ms, `doctor --offline --skip-sim` 65 ms (passes) and `publish --dry-run` 74 ms, one run, offline, on a CI Linux runner, 2026-11-05 (`scripts/first-run/`). Doctor skips the simulator checks because a fresh scaffold has no install or Chromium yet. Install, bundle export, store builds and a real applied OTA are not timed, so this is not the full path. | Add a timed first-run job in CI on a clean machine (bet 3). |
| Update safety on device (Android) | Publish to applied 16–36 s; patch 64 KB vs 1.57 MB full; crash-loop revert after 3 failed boots; cold start 847–931 ms on a Redmi 9A (Android only) | [spike results](../spike-results.md), 2026-10-30 |
| Simulator-vs-device parity | 100% actionable on 13 screens (Flows A and B) on Android and iOS; text 98.6% Android, 96.2% iOS | [parity results](../parity-results.md) |
| Agent task success without screenshots | 5/5 Haiku, after 4/5 Sonnet on round 1 | [agent gate results](../agent-gate-results.md) |
| GitHub stars and forks | Not read this week (the GitHub call was blocked in this run) | `gh api repos/shipvo/shipvo --jq '.stargazers_count,.forks_count'`; record next week |
| Outside issues | 0 seen: all 8 issues were opened by one account | `gh issue list --state all --json number,author` |

## 4. Where we win

Facts about competitors come from DeepWiki and web searches on 2026-11-04. Vendor claims are marked as such.

- **Expo EAS Update.** Ahead of us on rollouts, dashboards and ecosystem. We are ahead on: signing is on for everyone, not a paid tier; self-hosting on Cloudflare; no per-update fee model. Behind on: iOS patches, polish, trust.
- **react-native-code-push.** A guide we read says App Center was retired in March 2025 and that CodePush still works with a self-hosted server ([AppsOnAir](https://www.appsonair.com/blogs/app-center-is-gone-why-react-native-teams-still-need-a-codepush-strategy-in-2026)). Teams that lost their host are looking. We win if migration is easy. We have one blog post with a three-step migration section ([a CodePush alternative after App Center](../../blog/a-codepush-alternative-after-app-center.md)), but no full step-by-step migration guide in `docs/`.
- **hot-updater (`gronxb`).** It is the closest peer: self-hostable, with signing (0.23.0), staged rollout 1–100% (0.29.0) and rollback recovery (0.28.0), per DeepWiki (version numbers unverified). We are ahead on: a measured on-device crash-loop revert, bsdiff patches on Android, signed pointers with platform binding, and the agent half. Behind on: percentage rollouts (we have cohort bands only) and community size.
- **Capgo (`capacitor-updater`).** It targets Capacitor, not React Native, and its vendor docs claim delta updates and encryption. Different audience. We do not compete head on.
- **Maestro.** It ships an MCP server inside its CLI (blog post dated 2026-04-14) and a viewer that embeds devices in coding agents (CLI 2.6.0, unverified: from a secondary summary). It tests real devices and emulators. We are ahead on: no device or emulator needed, a typed test API for CI, and one app artifact shared with OTA. Behind on: real-device coverage and users.
- **mobile-mcp.** An Apache-2.0 MCP server that drives simulators, emulators and real devices and needs Xcode and Android platform tools. Star counts in the sources disagree, so we record none. We are ahead on: headless, no SDK install, hosted remote MCP. Behind on: works with any app, with no integration.

Our honest edge: **update safety that we measured, plus an agent-testable simulator that shares the same release.** We lose on anything that needs scale, a dashboard or a community.

## 5. Bets for the next 4 weeks

**Bet 1: A bundle can never reach a shell it cannot run.** (Update safety.)

- Outcome: shells declare their Hermes bytecode version; the control plane and runtime refuse a mismatched release before launch.
- How we will know: a test shows a mismatched release is not offered and not applied, with a typed reason in telemetry; zero bytecode-mismatch crash-loops in the Android emulator and iOS Simulator CI runs.
- First slice: schema field for the shell's declared bytecode version, plus control-plane check (follow-up of #10). Epic #14, slices #17 and #18.

**Bet 2: iOS reaches Android's update quality.**

- Outcome: iOS apply time and patch size are measured, and patches are small.
- How we will know: bsdiff patch on iOS verified in CI (#2); iOS apply time measured on the iOS Simulator in CI and published in `docs/spike-results.md` (#1).
- First slice: bsdiff patch apply in the Swift runtime with full-bundle fallback (#2). Epic #15.

**Bet 3: First run in under 10 minutes, and we can see it.**

- Outcome: a new user goes from `shipvo init` to a first applied OTA quickly, and we know the number.
- How we will know: a CI job times init to first publish on a clean runner and records the result; the north-star query exists.
- First slice: `shipvo doctor` (checks Node, key, config, control-plane reachability) with tests (#19), then the north-star query (#20). Epic #16.

## 6. Not doing (and why)

- **Percentage rollouts and a web dashboard.** EAS and hot-updater already have percentage rollouts. Bet 1 and 2 reduce the chance a rollout is needed at all. Revisit once an outside team asks.
- **Automatic rollback on crash-rate telemetry.** Needs fleet data we do not have yet. Crash-loop revert on the device already works.
- **Real-device farm for agents.** Maestro and mobile-mcp cover it. Our edge is headless.
- **Shipping native code over the air.** Unchanged from the roadmap.
- **New marketing pages or blog posts.** The site has 18 blog posts (`blog/`) and no outside user yet. Evidence first.
- **Capacitor support.** Different audience.

## 7. Changelog of this document

- 2026-11-04: First version. Set the beachhead user, three bets (bytecode safety on shells, iOS parity, first-run and measurement) and the metrics, because the first week of merged work (Hermes check, French docs) shows update safety is the live front and we have no adoption measure yet.
