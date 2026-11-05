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
- Simulator-vs-device parity: close every gap listed in `docs/parity-results.md`.
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

**Win the lane (owner direction, 5 to 6 Nov 2026):**
- Shipvo Phone: a native-feeling simulated phone, Android style and iPhone style, with gestures, notification shade and Control Center, Settings, restart, an app store inside the phone, a built-in Browser app, real browser camera, mic and location with simulated fallback, and agent control of everything over MCP (#466)
- `shipvo run android|ios`: the app on Shipvo Phone in your own browser in seconds, no Playwright needed; your coding agent drives the same live phone while you watch, with screenshots and demo-video recording (#442)
- From working app to both stores: route by account type, the 12-testers clock with the Shipvo Testers group, screenshot studio, store forms (#249)
- Framework adapters: Capacitor first, then Cordova (signed web-bundle updates, `shipvo eas setup`, own-CI build template) (#297)
- Learn: top-level section with interactive tutorials, videos, search and filters

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

## Not doing (for now)

- Shipping compiled native code over the air. Updates stay interpreted JavaScript on capabilities the shell declares.
- Anything that weakens signing or lets an update replace its own trust root.
