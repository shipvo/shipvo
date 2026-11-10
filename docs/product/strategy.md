# Shipvo strategy

Owner: Head of Product agent. Reviewed weekly. Last review: 2026-11-10.

## 1. Vision and who we serve first

**Vision.** A React Native team should be able to ship a fix to every phone in under a minute, and trust that a bad release cannot brick the app. An AI agent should be able to open, use and test that same app without a phone. One signed release feeds both. The owner's direction (November 2026) sets the lane: Shipvo is the release control plane for mobile apps, for people and AI agents, and the mobile platform for the AI era ([platform](platform.md)).

**Beachhead user.** A small React Native team (1 to 5 developers) that already ships an Expo or bare RN app on both stores, that cannot or does not want to pay per-update fees, and that runs on slow networks and low-end Android phones. They want to self-host on Cloudflare or use the hosted `api.shipvo.dev`. Our own evidence comes from this user: the spike was measured on a 2 GB Xiaomi Redmi 9A on 4G in Douala ([spike results](../spike-results.md)). The second user, who has equal weight, is a non-technical founder who describes an app to an agent, watches it on Shipvo Phone in the browser and ships it. A third is a developer who wants Claude, ChatGPT or another agent to test their app in CI through MCP.

## 2. Jobs and reasons to choose something else

Jobs:

1. "Fix a production bug now without waiting for store review, and not break anyone's phone."
2. "Roll a change out to a few users first, and undo it fast."
3. "Let an AI agent check my app works before I ship it, without me running emulators."

Why they would still choose something else today:

- **Expo EAS Update** is the default for Expo apps. It has per-update rollout percentages, rollback commands, end-to-end code signing (paid plans only, per DeepWiki on `expo/expo`) and bsdiff patch support. Shipvo has no polished dashboard and a much smaller community.
- **No track record.** We have one sample app in the evidence. No outside team has told us they ship with Shipvo (every issue we can see, 753 of them, was opened by one account or the automation bot).
- **Release health is hard to see.** Telemetry, auto-halt and the audit log exist, but there is no one view of a release's health, and no rollout stated as a percentage, which EAS Update and hot-updater both offer (bet 2).
- **The format is only in code.** Nobody else can implement or check a Shipvo release (bet 3).
- **Maestro and mobile-mcp** already have users for agent-driven testing on real devices and emulators. Our simulator only covers what the app exposes in React Native Web.

## 3. Metrics

**North-star metric: weekly OTA releases applied and healthy on devices that are not ours** (owner's stage 1 proof: 1,000 apps live with real weekly healthy releases). Not measured yet: the query script exists (`scripts/metrics/north-star.mjs`, #20) but no production telemetry has been read into this document. Next step: run it against the hosted control plane and record the count here (bet 1).

Input metrics:

| Metric | Current value | Source or how to measure |
| --- | --- | --- |
| npm downloads, last week (2026-11-03 to 2026-11-09) | `@shipvo/test` 2,564; `@shipvo/device` 2,538; `@shipvo/cli` 2,321; `@shipvo/sim` 2,272; `@shipvo/runtime` 2,217; `@shipvo/schema` 2,204; `@shipvo/store` 1,857; `@shipvo/mcp` 1,265; `@shipvo/capacitor` 702; `@shipvo/spec` 671; `shipvo` 551; `create-shipvo` 524. A week earlier (2026-10-28 to 2026-11-03): mcp 1,299; cli 830; sim 602; device 592; runtime 582; schema 474; test 238 | `node scripts/metrics/adoption.mjs`, read 2026-11-10 (npm API). These include CI installs and mirrors; they are not unique users, and we cannot tell which part is outside use. These include CI installs and mirrors; they are not unique users. |
| Time from first `shipvo init` to first published release | Measured end to end through publish: on a clean ubuntu-latest runner, 2026-11-05, head e7f370a, [run 42106321217](https://github.com/shipvo/shipvo/actions/runs/42106321217), all steps exit 0. `init` 0.11 s, `pnpm install` 4.53 s, `doctor` 0.10 s, browser install 7.94 s, first agent session 8.50 s, `publish` (includes the Expo export) 10.70 s, signed-pointer check 0.01 s. Total 32.97 s. Publish to applied, measured separately: **Android**, Android emulator (API 30, x86_64, google_apis, pixel_5) on ubuntu-latest, 2026-11-06, head 4b3724b, [run 42217980387](https://github.com/shipvo/shipvo/actions/runs/42217980387), step "Time the first applied OTA on the emulator": second `publish` 10.93 s, publish to healthy 10.02 s (first open 2.80 s). In the same step the APK build took 299.93 s, which is not part of the Shipvo figure. **iOS**, iOS Simulator on macos-26, 2026-11-06, head 9993f10, [run 42217957485](https://github.com/shipvo/shipvo/actions/runs/42217957485), step "First applied OTA, publish to healthy (release 6, #668)": download 68 ms, apply 375 ms, healthy 2.63 s, 3.02 s from launch to healthy; "publish" there is signing and writing the pointer (`make-release.mjs`, 389 ms), not `shipvo publish`. The two platforms use different apps and publish paths, so do not add or compare them. Each is one run, not a median. Not timed: one continuous init-to-applied run on a single device (the Android steps above ran in one job, but the 32.97 s figure comes from a separate job), `shipvo publish` on iOS, store builds, installing the app, and time spent reading docs or writing app code. | Time one continuous init-to-applied run per platform, and repeat for a median (bet 3). |
| Update safety on device (Android) | Publish to applied 16–36 s; patch 64 KB vs 1.57 MB full; crash-loop revert after 3 failed boots; cold start 847–931 ms on a Redmi 9A (Android only) | [spike results](../spike-results.md), 2026-10-30 |
| Update size and apply time (iOS Simulator) | First update from the embedded bundle as a bsdiff patch: median 83,999 bytes vs 1,996,082 bytes full bundle; median patch apply time (last byte to healthy, includes reload) 573 ms (3 runs; Xcode 26.6, `macos-26-arm64`) | [run 42087991990](https://github.com/shipvo/shipvo/actions/runs/42087991990), 2026-11-05; [spike results](../spike-results.md#ios-patch-size-and-patch-apply-time) |
| Simulator-vs-device parity | 100% actionable on 13 screens (Flows A and B) on Android and iOS; text 98.6% Android, 96.2% iOS | [parity results](../parity-results.md) |
| Agent task success without screenshots | 5/5 Haiku, after 4/5 Sonnet on round 1 | [agent gate results](../agent-gate-results.md) |
| GitHub stars and forks | 2 stars, 0 forks (read 2026-11-10) | `gh repo view shipvo/shipvo --json stargazerCount,forkCount` |
| Outside issues | None confirmed. `gh issue list --state all --limit 1000` on 2026-11-10 shows two authors: `Hansade2005` (662) and `app/github-actions` (91). `adoption.mjs` reports 1,521 issues and PRs from non-team logins, all from the account we treat as the owner's | `node scripts/metrics/adoption.mjs`, pass `--team Hansade2005` to exclude it |

## 4. Where we win

Facts about competitors come from DeepWiki and web searches on 2026-11-10; vendor claims are marked. react-native-code-push and Capgo were not re-read this week, so their lines are unchanged from 2026-11-04.

- **Expo (EAS Update, EAS Simulator).** Per DeepWiki on `expo/expo`: bsdiff patch downloads are on by default on Android and iOS, rollouts take a percentage (`eas update --rollout-percentage`), `eas update:rollback` exists, and an EAS Simulator runs remote iOS Simulators and Android Emulators for agents, alongside the open-source `agent-device` CLI. Ahead of us on: rollout percentage, dashboards, ecosystem. We are ahead on: signing for everyone, self-hosting on Cloudflare, no per-update fee model, an instant browser phone, testing and demos, a measured crash-loop revert, and the store path. We work with Expo: EAS builds and submits.
- **react-native-code-push.** A guide says App Center was retired in March 2025 and CodePush still works with a self-hosted server ([AppsOnAir](https://www.appsonair.com/blogs/app-center-is-gone-why-react-native-teams-still-need-a-codepush-strategy-in-2026)). Teams that lost their host want an easy move. We have [migrate-from-codepush](../migrate-from-codepush.md); bet 1 puts a measured run behind it.
- **hot-updater (`gronxb`).** The closest peer. Per DeepWiki: RSA-SHA256 signing (0.23.0), rollout 1 to 100% (0.29.0), crash-counter rollback (0.28.0), bsdiff for Hermes bytecode, storage on S3, R2 or Supabase, an Expo config plugin (version numbers unverified). We are ahead on: signed pointers with platform binding, measured crash-loop revert on Android and iOS, the agent half, the browser phone. Behind on: rollout percentage and community size (bet 2 closes the first).
- **Capgo (`capacitor-updater`).** Targets Capacitor. Our Capacitor adapter (`@shipvo/capacitor`, #297) means we now overlap; Capgo's delta and encryption claims are vendor claims we have not tested.
- **Maestro.** Per its release notes: CLI 2.6.0 (2026-05-25) added Maestro Viewer, opened by an MCP tool; CLI 2.7.0 (2026-07-20) added `describe_cloud_run` so an agent debugs a failing cloud run ([2.7.0 post](https://maestro.dev/blog/maestro-cli-2-7-0)). We are ahead on: no device or emulator install to start, a typed test API, agents that write and repair tests (`shipvo test --repair`, `shipvo lumi`), and one artifact shared with OTA. Behind on: users and cloud device runs.
- **mobile-mcp.** Its roadmap lists screen recording (2026-03-03), crash listing and its own Device Kit replacing WebDriverAgent on the iOS Simulator (2026-05-01); sources disagree on its version, so we record none. We are ahead on: a whole phone (apps, store, hardware, lifecycle), hosted remote MCP, recording with markers, OTA and the store path. Behind on: works with any app on a real emulator with no integration.

Our edge: **a whole agent-operable phone in the browser, plus signed updates that we measured, in one open release flow.** Expo now sells remote simulators for agents, so the gap we grow is the parts they do not have: instant browser phone, free self-hosting, demos, testing inside your own build loop. We lose on scale, dashboards and community, so bet 2 is the dashboard answer.

## 5. Bets for the next 4 weeks

The three bets of 2026-11-04 (#14 bytecode safety, #15 iOS parity, #16 first run) are closed and merged, as is release governance (#295). New bets:

**Bet 1: Adopt mode proven on three app shapes, to a first healthy update on Android and iOS.** (Epic #1613.)

- Outcome: an Expo or bare React Native app goes to a healthy signed update on both platforms, with run links behind the migration guides. This is the path to the stage 1 proof of 1,000 live apps and to a first non-owner data point.
- How we will know: CI jobs on the Android emulator and iOS Simulator pass for Expo managed, Expo prebuilt and bare fixtures; the north-star count is read from production telemetry and written here; the first outside issue or app appears.
- First slice: CI runs adopt mode on three fixtures (#1616), then the applied OTA runs (#1617, follows #751).

**Bet 2: Release health at a glance.** (Epic #1614.)

- Outcome: one answer per release (applied, healthy, reverted, halted, by band) in the API, the CLI and `/admin`, then rollout stated as a percentage. Removes the main reason to pick EAS Update or hot-updater.
- How we will know: the same numbers appear in route, `shipvo status --json` and `/admin` from one fixture, for Android and iOS rows.
- First slice: control-plane route (#1618), then the CLI and panel (#1619).

**Bet 3: The release format as an open spec.** (Epic #1615.)

- Outcome: another tool can implement and verify a Shipvo release without our code. Owner advantage 2, and the base of stage 3.
- How we will know: an independent verifier using only Node `crypto` passes every conformance vector in CI.
- First slice: the spec document (#1620), then vectors (#1621).

## 6. Platform growth

- **Layers to extend next: Ship and Manage.** Bet 2 adds release health to the control plane and `/admin`; bet 3 turns the core's format into a public contract. Simulate and Device keep growing through the owner's open epics (#466, #839, #843, #842, #1188), which are already in flight.
- **New package this month: none.** Three packages arrived in recent weeks (`@shipvo/spec`, `@shipvo/store`, `@shipvo/capacitor`), and the core still has open safety work (#1414, #1444). The rule is one new package a month and only on a solid core. Candidate for December if bet 3 lands: a small verifier package for the release format, opened as a `new-package` epic then.

## 7. Design

From the dogfood runs ([2026-11-06 shop](dogfood/2026-11-06-shop.md)) and the open design and dogfood issues:

1. **First run breaks on small things.** The shop dogfood waited about 7 minutes on a simulator start-up check that crashed; open issues show the same family: no simulator gives a raw `ECONNREFUSED` (#1577), the shop template fails its own typecheck (#1576), SIGTERM leaves the simulator answering 500 (#1575). Each has a fix in review. Next check: a clean-runner first-run job that fails on any of these.
2. **Release state is invisible.** People cannot see what is live and healthy without reading logs. Bet 2 addresses it in `/admin` and the CLI.
3. **Docs and site on phones.** Tap-target fixes landed on the home, apps, features and blog pages (#1514, #1515); the playground shell is in progress (#1239). Keep every new page checked at phone width.

## 8. Not doing (and why)

- **A separate web dashboard product.** Bet 2 puts health in the existing `/admin` and CLI.
- **Shipping native code over the air.** Unchanged from the roadmap.
- **Building or submitting customers' apps through a Shipvo-owned Expo account.** The owner's direction: customers bring their own EAS account or use their own CI.
- **A new package this month.** See section 6.
- **More blog posts and marketing pages from the strategy lane.** The content lanes follow shipped features; strategy effort goes to adoption proof.
- **A real-device farm.** Android emulators and the iOS Simulator in CI are the test standard.
- **Cordova adapter before Capacitor has an outside user.** Epic #297 stays in flight; we add no new framework this month.

## 9. Changelog of this document

- 2026-11-04: First version. Set the beachhead user, three bets (bytecode safety on shells, iOS parity, first-run and measurement) and the metrics, because the first week of merged work (Hermes check, French docs) shows update safety is the live front and we have no adoption measure yet.
- 2026-11-10: Replaced the three closed bets (#14, #15, #16) with adopt-mode proof (#1613), release health (#1614) and the open release spec (#1615), because those epics and governance (#295) are done, npm downloads rose to 2,200 or more per package with no outside issue or star beyond 2, and Expo now sells remote simulators and rollout percentages. Added platform growth and design sections.
