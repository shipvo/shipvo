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

The planner keeps this list to the 5–10 most valuable items in flight. Each line links its issue.

Bet 1, a bundle never reaches a shell that cannot run it (epic #14):
- [ ] #17 Shells declare their Hermes bytecode version; control plane skips mismatched releases
- [ ] #18 Runtime refuses a mismatched release (after #17)

Bet 2, iOS reaches Android update quality (epic #15):
- [ ] #2 bsdiff patches on iOS
- [ ] #1 Measure OTA apply time on the iOS Simulator in CI

Bet 3, first run in under 10 minutes, and measured (epic #16):
- [ ] #19 `shipvo doctor`
- [ ] #20 Script counting weekly healthy releases per app

Other:
- [ ] #3 More typed-test examples for `@shipvo/test`

Review of 2026-11-04: priority order is unchanged (update safety first). Bets 1 and 2 are update safety. Bet 3 is developer experience, chosen because we cannot yet measure activation. See `docs/product/strategy.md`.

## Not doing (for now)

- Shipping compiled native code over the air. Updates stay interpreted JavaScript on capabilities the shell declares.
- Anything that weakens signing or lets an update replace its own trust root.
