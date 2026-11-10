# Shipvo roadmap

This is the working direction for the project. It is owned by the Head of Product agent, which reviews it every Monday against evidence (adoption, research, competitors) and plans from it four times a day; the strategy behind it is in `docs/product/strategy.md`. Changes go through normal pull requests, and the owner can override anything here.

## Goal

Make building, testing and maintaining mobile apps easy and accessible to everyone, including non-technical founders working with an AI agent. Shipvo is infrastructure: a small, safe core (signed updates, schema, control plane, simulator) with products and packages built on it. See `docs/product/platform.md`.

First, make Shipvo the most dependable way to ship React Native updates without the store, and the best way for AI agents to use and test a mobile app without a phone.

Order of priority when choosing work: **correctness and safety of updates > reliability of the simulator > developer experience > new features > docs and polish.**

## Themes

### 1. Update safety and reach
- Shells declare the Hermes bytecode version they run, and mismatched releases are refused (epic #14).
- bsdiff patches on iOS (issue #2); measure OTA apply time on the iOS Simulator in CI (issue #1).
- Stronger rollback: rollback by cohort, automatic rollback on crash-rate thresholds from telemetry.
- Docker self-hosting target for the control plane.
- Resumable and delta downloads on slow networks; measure on low-end Android.

### 2. Simulator and MCP reliability
- Stable element refs across scroll, re-render and navigation.
- More device capabilities simulated (contacts, calendar, file picker, deep links, push payloads), each with a declared support level.
- Simulator-vs-device parity at 100% on every flow, on the Android emulator and the iOS Simulator.
- Faster session start and lower memory per session on the hosted simulator.
- Clear, typed errors from every MCP tool.

### 3. Developer experience
- `shipvo init` templates (blank, shop, content app) that pass CI on first run.
- `@shipvo/test`: more matchers, fixtures, network mocking and examples (issue #3).
- Better CLI output and error messages, `shipvo doctor`.
- Framework support beyond the sample app's stack.

### 4. Observability for releases
- Release dashboard data in the control plane: adoption by cohort, crash-loop count, cold-start time.
- Alerts (webhook) when a release is reverted on devices.

### 5. Docs and examples
- Every exported API documented with a runnable example.
- Translated Getting started (issue #4).
- Guides generated from real CI runs, never from guesses.

## Now

The planner keeps this list current: the epics in flight, newest owner direction first. Each line links its epic; open the epic for its slices.

**Lumi (owner direction, 6 Nov 2026):**
- Lumi in every Shipvo Phone: the assistant that shows each step live, reacts to results, appears in recordings and guides new users (#872)
- Lumi Autotest: `npx shipvo lumi` builds your app, opens it on Shipvo Phone, and Lumi tests it from start to finish while you watch, free and on your own machine, learning from its own test runs (#878)
- Story episodes: a weekly Shipvo series with Amara and Lumi, drawn in code, voiced and lip-synced (#859, #860)
- Same task, two ways: screenshots against Shipvo's labelled screen, measured (#837)

**Win the lane (owner direction, 5 to 6 Nov 2026):**
- Shipvo Phone: a native-feeling simulated phone, Android style and iPhone style, with gestures, notification shade and Control Center, Settings, restart, an app store inside the phone, a built-in Browser app, real browser camera, mic and location with simulated fallback, and agent control of everything over MCP (#466)
- `shipvo run android|ios`: the app on Shipvo Phone in your own browser in seconds, no Playwright needed; your coding agent drives the same live phone while you watch, with screenshots and demo-video recording (#442)
- From working app to both stores: route by account type, the 12-testers clock with the Shipvo Testers group, screenshot studio, store forms (#249)
- Framework adapters: Capacitor first, then Cordova (signed web-bundle updates, `shipvo eas setup`, own-CI build template) (#297)
- Learn: top-level section with interactive tutorials, videos, search and filters

**The assistant's phone and app engine:**
- The Shipvo app engine: declarative specs become native-feeling Android and iOS apps (#839)
- The assistant's phone, one per person, with the first five first-party apps (#843)
- Shipvo Runner: one spec runner, one schedule dispatcher and one MCP tool registry for remote and stdio (#842)
- Secret vault: keys go from the person straight into an encrypted vault, never through the model (#841)
- Security hardening from the external review (#732)

**Agents together (planner epic):**
- Agents use apps together: shared rooms, sub-agent teams and agent evaluation (#1188)

**Stage 2:**
- The closed QA loop: an agent explores, tests in plain language, repairs its tests, and the fix ships to 1% the same hour (#317)
- Release governance: audit log, approvals, release policy as code (#295)
- Enterprise access and hosting: single sign-on, roles, private deployment, LTS (#296)

**Finishing:**
- A bundle never reaches a shell that cannot run it (#14)
- iOS reaches Android update quality (#15)
- First run in under 10 minutes, and measured (#16)

## Shipped

Newest first. One line per user-visible feature. Dates are each PR's merge date. `#NNN` are pull request numbers.

- 2026-11-10: Revoke a saved key from the Secrets screen, `app_activity` shows what the agent built and changed, and three more example specs: expense splitter, trip checklist and flashcards ([Phone apps](phone-apps.md#see-saved-keys-in-settings), [Example specs](spec-blocks.md#example-specs), #1388, #1396, #1385)
- 2026-11-10: Arrange the home screen with `arrange_apps` (pin, hide, position, schedule) and set the phone's clock with `set_phone_time`, on Android and iOS ([Phone apps](phone-apps.md#arrange-the-home-screen), #1349)
- 2026-11-10: Watch link on the hosted phone: `open_app` returns a read-only `watch_url` ([Agents](agents.md#watch-link-on-the-hosted-phone), #1277)
- 2026-11-10: Data sources refresh on an interval (`refresh`), a gallery of example specs, and faster rebuilds in `shipvo run` after a save ([Keep a data source fresh](spec-blocks.md#keep-a-data-source-fresh), [Example specs](spec-blocks.md#example-specs), [shipvo run](run.md), #1351, #1358, #1367)
- 2026-11-10: Spec `calendar` and `map` blocks, the Secrets screen in phone Settings, and opening a build from a `build_url` ([App spec](spec-blocks.md#calendars-and-maps), [Phone apps](phone-apps.md#see-saved-keys-in-settings), [Test your build](test-your-build.md#open-a-build-from-a-link), #1353, #1350, #1287)
- 2026-11-10: Network profile tools for MCP, typed tests and `phone.json` ([Device API](device-api.md#network-profiles), #1338)
- 2026-11-10: Playground Many phones: 1 to 12 Android and iOS phones with a shareable link ([Getting started](getting-started.md#try-it-in-your-browser-first), #1323, #1335)
- 2026-11-10: Secrets screen in the phone's Settings lists saved keys, metadata only ([Phone apps](phone-apps.md#see-saved-keys-in-settings), #1350)
- 2026-11-10: Pin and hide apps on the home screen, export and import a phone's apps, and search the Store with `find_apps` ([Phone apps](phone-apps.md), #1330, #1329, #1315)
- 2026-11-10: Saved-key routes (list, rotate, revoke, use log) in the control plane and the simulator, and key rotations in the pointer response ([Self-hosting](self-hosting.md#saved-key-routes-vault), #1298, #1334, #1336)
- 2026-11-09: Describe an app and it appears, edit it in place with `update_app` ([Phone apps](phone-apps.md), #1301, #1302)
- 2026-11-09: Job handles for slow MCP tools: `job_status` and `wait_ms` on `publish_preview` and `upload_build` ([CLI guide](cli.md), #1314)
- 2026-11-09: SAML sign-in routes in the control plane ([Single sign-on](sso.md), #1272)
- 2026-11-08: Wallet, Calendar, Files and Photos, and Shop first-party spec apps ([Phone apps](phone-apps.md#first-party-apps), #1275, #1252, #1299, #1300)
- 2026-11-08: App spec `vector` block, `motion`, translations, locale formatting and right-to-left ([App spec](spec-blocks.md#vector-drawings), #1271, #1274)
- 2026-11-08: Playground Device API and over-the-air update panels, Android and iOS ([Getting started](getting-started.md#try-it-in-your-browser-first), #1276, #1278)
- 2026-11-07: `kanban` and `timeline` app spec blocks, with `App.move` and an `onMove` action, on Android and iOS skins ([Boards and timelines](spec-blocks.md#boards-and-timelines), #1245)
- 2026-11-07: The hosted MCP serves OAuth discovery and dynamic client registration, so clients can sign in themselves ([Agents](agents.md), #1216)
- 2026-11-07: `/watch` shows the agent's phone live, in its Android or iOS frame ([Agents](agents.md#watch-the-agents-phone), #1217)
- 2026-11-07: `shipvo eval run` and `shipvo eval report` score any agent or model on an app task: pass rate, steps, time, errors and retries on Android and iOS ([Score an agent](eval.md), #1201)
- 2026-11-07: Sessions that open an app with the same `room` share one backend; `list_sessions` shows room, opener and screen ([Agents](agents.md#rooms-several-phones-one-backend), #1203)
- 2026-11-07: `shipvo agents setup --hosted` writes the hosted Shipvo phone config for each coding agent ([CLI guide](cli.md), #1215)
- 2026-11-07: Run Android and iOS simulators on your own machine or CI runner: 110 open at once on a 2-CPU, 7.8 GB machine ([Shipvo Simulators](https://shipvo.dev/products/simulators/), #1235)
- 2026-11-07: Test your own build on the hosted phone with `upload_build` or `shipvo sim --hosted`, then `open_app("<app>@build:<id>")` ([Test your build](test-your-build.md), #1171)
- 2026-11-07: Two assistants play a full chess game through `@shipvo/mcp` with `--agents`, and `--record` saves the video and the moves ([Chess on two phones](demos/chess.md), #1166)
- 2026-11-07: `open_app` starts or switches the phone (`platform`, `show`) and you watch the agent drive it ([Agents](agents.md), #1163)
- 2026-11-07: With the network off, the app's `fetch` and `XMLHttpRequest` calls fail like on a phone, in sim, MCP and test sessions on Android and iOS ([Device API](device-api.md#network), #1161)
- 2026-11-07: Payment cancel comes back as `cancelled` ([Device API](device-api.md#payments), #1158)
- 2026-11-07: `shipvo agents setup` writes the Shipvo MCP config for every coding agent ([CLI guide](cli.md), #1155, #1156)
- 2026-11-07: Deep links: `open_url` and `Linking.openURL` switch to the owning app and deliver the link once ([Phone apps](phone-apps.md), #1132, #1140)
- 2026-11-07: Spec blocks `chart`, `stat`, `progress`, `card`, `toggle`, `segmented` and sheet navigation ([App spec](spec-blocks.md), #1129, #1134)
- 2026-11-07: `shipvo ci shots` captures Android and iOS on base and head ([Check every pull request](ci-check.md), #1126)
- 2026-11-07: `shipvo explore --save-tests` and Save as test in Lumi ([Lumi](lumi.md), #1085)
- 2026-11-07: Notes and Tasks, the first first-party spec app on Shipvo Phone ([Phone apps](phone-apps.md), #1088)
- 2026-11-07: Self-hosted control plane has `backup` and `restore` commands and an upgrade check ([Self-hosting](self-hosting.md), #1087)
- 2026-11-07: `shipvo run` shows a Rebuilding line as soon as you save on Android and iOS ([Run on a phone](run.md), #1111, #1130)
- 2026-11-07: iOS trial boots run under the UIScene lifecycle ([CLI guide](cli.md), #1103, #1113)
- 2026-11-07: Live chess demo at [shipvo.dev/demos/chess](https://shipvo.dev/demos/chess/): an Android phone and an iPhone play in your browser, and you can take white ([Chess on two phones](demos/chess.md), #1168)
- 2026-11-07: Behaviour timeline in the app admin compares releases and pull requests on Android and iOS ([Behaviour timeline](timeline.md), #1084)
- 2026-11-07: `shipvo test --device agent-device` runs flows on a real emulator or simulator ([Test your app in CI](testing.md), #1041)
- 2026-11-06: `shipvo lumi` opens your app on Shipvo Phone with a sidebar that tests it while you watch ([Lumi](lumi.md), #880)
- 2026-11-06: Lumi lives in the Shipvo Phone frame (idle, working, happy, worried), with an off switch ([Run on a phone](run.md), #885)
- 2026-11-06: `shipvo explore` picks smarter next steps, fills forms, finds failed network calls, stuck loading and blank screens, and repeats runs with `--seed` ([Agents](agents.md), #886)
- 2026-11-06: Screenshots of the live phone in `shipvo run` ([Run on a phone](run.md), #834)
- 2026-11-06: Network profiles on Shipvo Phone: the app's requests follow the chosen network ([Device API](device-api.md), #833, #855)
- 2026-11-06: Over-the-air updates on Shipvo Phone: update state, check, apply and crash-loop revert, driven over MCP ([Agents](agents.md), #796)
- 2026-11-06: The stdio and remote MCP servers share one tool registry, so both offer the same tools ([Agents](agents.md), #854)
- 2026-11-06: `@shipvo/spec`: the app spec JSON Schema and validator ([App spec](design/app-spec.md), #853)
- 2026-11-06: `shipvo keys rotate` signs and uploads a new update key ([Key rotation](key-rotation.md), #812)
- 2026-11-06: `shipvo run android|ios` opens a phone frame in your browser; your assistant attaches to it with `open_app` ([Run on a phone](run.md), #454, #500, #510, #519, #540)
- 2026-11-06: `record_start`, `record_marker` and `record_stop` write an MP4 of the phone ([Record a demo video](record.md), #525)
- 2026-11-06: `shipvo promote` refuses releases with failing test flows; `shipvo test --report-md`; `secret()` in tests ([Testing](testing.md), #489, #490, #493)
- 2026-11-06: Shipvo Testers group and `shipvo store testers` ([Store](store.md), #520)
- 2026-11-06: Real camera, microphone and location in the browser with simulated fallback ([Device API](device-api.md), #474)
- 2026-11-06: Control plane enforces weekday and staged-rollout policy rules on publish ([CLI guide](cli.md), #506)
- 2026-11-06: The `shipvo` skill for coding agents, `npx skills add` ([Agents](agents.md), #537)
- 2026-11-05: Release rules in `shipvo.json` (`policy`), checked by `shipvo publish --dry-run-policy` and enforced on publish by the control plane ([CLI guide](cli.md), #426)
- 2026-11-05: `shipvo audit` exports the audit log; publishes, halts and rollbacks are recorded ([CLI guide](cli.md), #346, #353, #354, #359, #403)
- 2026-11-05: `shipvo explore` walks the app in the simulator and reports findings ([Agents](agents.md), #366)
- 2026-11-05: `shipvo test --repair` and `--report`; plain-English steps in `@shipvo/test` ([Testing](testing.md), #350, #396, #425)
- 2026-11-05: `shipvo preview` device panel, recording and tester comments ([Getting started](getting-started.md), #335, #338, #339, #369)
- 2026-11-05: MCP `tap`, `type`, `scroll` and `back` report delivery; `wait_for` and `settle` ([Agents](agents.md), #336, #337)
- 2026-11-05: Store help: `shipvo store details`, `setup`, `screenshots` ([Store](store.md), #315, #363, #386, #400)
- 2026-11-05: Capacitor: `@shipvo/capacitor`, `shipvo eas setup`, `shipvo ci init --framework capacitor` ([Capacitor](capacitor.md), #432, #428, #438)
- 2026-11-05: Hourly telemetry export to your R2 bucket as Parquet ([Telemetry export](telemetry-export.md), #324)
- 2026-11-05: `shipvo auto-halt` turns on automatic halting ([CLI guide](cli.md), #302)

## Promises

Lines we hold, whatever else changes.

- Updates stay interpreted JavaScript running on the capabilities the shell declares; compiled native code always ships through the stores.
- Update signing is never weakened, and an update can never replace its own trust root.
