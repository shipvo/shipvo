# Shipvo roadmap

This is the working direction for the project. The planner agent reads it every day to choose what to build next and keeps the "Now" list current through normal pull requests. A human sets the goals and themes.

## Goal

Make Shipvo the most dependable way to ship React Native updates without the store, and the best way for AI agents to use and test a mobile app without a phone.

Order of priority when choosing work: **correctness and safety of updates > reliability of the simulator > developer experience > new features > docs and polish.**

## Themes

### 1. Update safety and reach
- bsdiff patches on iOS (issue #2); measure OTA apply time on a physical iPhone (issue #1).
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

- [ ] #2 bsdiff patches on iOS
- [ ] #3 More typed-test examples for `@shipvo/test`

## Not doing (for now)

- Shipping compiled native code over the air. Updates stay interpreted JavaScript on capabilities the shell declares.
- Anything that weakens signing or lets an update replace its own trust root.
