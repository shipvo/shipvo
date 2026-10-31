---
title: React Native end-to-end tests in CI without an emulator
date: 2026-10-31
order: 21
author: Hans Ade
tags: Guides, Testing
seo_title: React Native E2E tests in CI without an emulator
summary: Detox, Maestro and Appium all need a simulator, an emulator or a device, and a built app. What that costs your CI, and a typed alternative that runs in plain Node.
---

End-to-end tests for a React Native app usually share one requirement: something has to pretend to be a phone. That something is slow to start, hard to cache, and the reason many teams run their E2E suite nightly instead of on every pull request.

## What the usual tools need

One comparison of the three common choices states the requirements plainly:

- **Detox** runs on an iOS simulator or an Android emulator, and needs a compiled build: "not Metro dev server." You build before the first run, and the iOS build goes through `xcodebuild`.
- **Maestro** runs on simulators, emulators or real devices. Its iOS CI example runs on a `macos-14` runner and installs the built `.app` into a booted simulator.
- **Appium** needs a built app, a running Appium server and a platform driver (XCUITest for iOS, UIAutomator2 for Android). It is rated the hardest of the three to set up in CI, and real-device farms are an option.

All three work in CI. What they have in common is the cost: a build step, a virtual device to boot, and, for iOS, a Mac runner.

## Why that hurts pull requests

A build and a boot before the first assertion means the feedback loop is minutes, not seconds. Teams respond by running fewer tests, or running them later, and a regression finds its way to `main` before anyone sees it. We wrote about the shape of the problem in [slow, brittle, expensive](/blog/slow-brittle-expensive/).

## A test that does not need a device

Shipvo's `@shipvo/test` package runs your app in a headless simulator inside the test process. There is no emulator to boot and no Mac runner needed. Tests are TypeScript, run under Vitest, and read the screen as an accessibility tree, the way a screen reader does:

```ts
import { test, expect } from "@shipvo/test/vitest";

test("a declined payment places no order", async ({ phone }) => {
  await phone.device.set({ payment: { nextResult: "decline", pin: "1234" } });
  await phone.tap("Place order");
  await phone.tap("Use fingerprint");
  await phone.tap("Confirm payment");
  await phone.waitFor("declined");
  expect(phone).toSee("declined");
});
```

`phone.device.set` changes what the simulated device does: location, camera, permissions, biometrics, network, and the result of the next payment. `waitFor` polls until the text appears or the timeout passes, so there is no sleeping. See [Test your app in CI](https://github.com/shipvo/shipvo/blob/main/docs/testing.md) for a complete GitHub Actions workflow.

## What this will not catch

A simulator is not a phone. It does not find native crashes, real camera or GPU behaviour, or slow-device performance. Everything it simulates is labelled as simulated. Keep a short pass on a real device before a store release, and use a tool like Maestro or Detox for that. The point is not to replace them. It is to put a fast test on every pull request so the slow one has less to find.

We publish where the simulator and real devices disagree: see the [parity results](https://github.com/shipvo/shipvo/blob/main/docs/parity-results.md).

## Sources

- [Detox vs Maestro vs Appium for React Native E2E testing](https://www.pkgpulse.com/guides/detox-vs-maestro-vs-appium-react-native-e2e-testing-2026), PkgPulse
