# Test your app in CI, before it reaches a phone

Shipvo's simulator runs your app headless, so every pull request can run your real flows (permission prompts, payments, notifications, offline) with no emulator, no device farm and no phone. A failing test blocks the merge, and with the scaffolded workflow it blocks the over-the-air publish too.

Yes, this works today. This repository's own CI runs it on every push and pull request on a plain `ubuntu-latest` runner: an 18-step purchase (barcode scan, location, mobile money, fingerprint, PIN, confirmation, notification) plus typed tests written with `@shipvo/test`.

## A test, in TypeScript

```ts
import { test, expect } from "@shipvo/test/vitest";

test("a declined payment is reported and no order is placed", async ({ phone }) => {
  await phone.device.set({
    payment: { nextResult: "decline", pin: "1234" },
    biometrics: { enrolled: true, nextResult: "success" },
  });
  await phone.tap("Place order");
  await phone.tap("Use fingerprint");
  await phone.type("Mobile money PIN", "1234");
  await phone.tap("Confirm payment");

  await phone.waitFor("Payment declined");
  expect(phone).not.toSee(/Order TT-\d+ placed/);
});
```

`phone` is a fresh simulated phone running your app. Everything is typed: `phone.device.set` knows the location, camera, permission, biometric, payment and network fields, and a typo is a compile error. Targets are what a person sees (`"Place order"`, `/^Open cart/`) or a role and name (`{ role: "textbox", name: "Mobile money number" }`). When nothing matches, or several things do, the error lists them and prints the screen.

## Set it up

New apps made with `npx shipvo init` already have this: `tests/app.test.ts`, `vitest.config.ts` and `.github/workflows/test.yml`. For an existing app:

```bash
npm i -D @shipvo/test vitest @shipvo/sim playwright
npx playwright install chromium
npx shipvo sim            # the simulator on http://localhost:4545
npx vitest run            # in another terminal
```

Put tests in `tests/*.test.ts`. The app id comes from `shipvo.json` (or `SHIPVO_APP`), and the simulator address from `PN_SIM` (default `http://localhost:4545`).

## The CI workflow

```yaml
name: test
on:
  pull_request:
  push: { branches: [main] }
  workflow_call:
jobs:
  simulator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Build the app for the simulator and serve it
        run: |
          npx shipvo sim --port 4545 > sim.log 2>&1 &
          for i in $(seq 1 180); do curl -sf localhost:4545/app/ >/dev/null && break; sleep 1; done
      - name: Test the app in the simulator
        run: npx vitest run
```

To make tests gate the over-the-air publish, call the workflow from `publish.yml` (the scaffold does this):

```yaml
jobs:
  test:
    uses: ./.github/workflows/test.yml
  publish:
    needs: test
    # …build, sign and publish as before
```

## What to test

- **Checkout and payments.** Approve, decline, time out, insufficient funds: `payment: { nextResult: "decline" }`. Assert the order is, or is not, placed.
- **Permissions.** Allowed, denied and never asked: `permissions: { camera: "denied" }`. Check the app explains itself instead of failing silently.
- **Location features.** Set where the phone is, check distances, delivery zones and "near me" results.
- **Camera and barcodes.** Put a code in front of the camera: `camera: { barcode: { type: "qr", data: "…" } }`.
- **Fingerprint and Face ID.** Success, failure and cancel: `biometrics: { nextResult: "fail" }`.
- **Offline.** `online: false`, then check queued actions and error messages.
- **Push notifications.** `phone.notify(...)`, then `phone.openNotification()` and assert the deep link lands on the right screen.
- **Release regressions.** Keep the flows that earn money in a test file. A change that breaks them fails the pull request, not a customer.
- **Dark mode.** `openApp({ dark: true })`.

## Not Vitest? Any runner works

`@shipvo/test` has no test-framework dependency. Use `openApp` from Jest, Playwright Test, `node:test` or a script:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp } from "@shipvo/test";

test("search opens", async () => {
  const phone = await openApp({ app: "myshop" });
  await phone.tap("Open search");
  assert.ok(phone.sees("Search"));
});
```

## What this catches, and what it does not

It catches what breaks in logic and flow: wrong screens, broken navigation, missing validation, mishandled permission answers, payment and notification handling, regressions between releases. The simulator renders your app with React Native Web and simulates the device API, so it does not catch native crashes, real-camera or real-GPU behaviour, OS-specific layout, or performance on a slow phone. Every simulated device feature is checked against real Android and iOS and the gaps are published in [simulator vs device parity](parity-results.md). Use the simulator to catch bugs early and on every commit, and keep a short pass on real devices before a store release.

For open-ended exploration, point an AI assistant at the same simulator over [MCP](agents.md): scripted tests are deterministic and belong in CI, an agent finds the things you did not think to write down.

## API

`openApp({ app?, sim?, dark?, seedCart?, device? })` returns a `Phone`:

| | |
|---|---|
| `phone.tap(target)` | Tap a button, link or choice. |
| `phone.type(target, text, { enter? })` | Type into a field. |
| `phone.scroll(direction, on?)` | Scroll the page or a rail. |
| `phone.back()` | Go back one screen. |
| `phone.sees(text)` / `phone.screen` / `phone.nodes()` | Read what is on screen. |
| `phone.waitFor(text, { timeout? })` / `waitForGone` | Wait for something to appear or disappear. |
| `phone.device.set({...})` / `device.reset()` | Location, camera, permissions, biometrics, payment, network. |
| `phone.notify({...})` / `notifications()` / `openNotification()` | Push notifications and the shade. |
| `phone.deviceLog()` | What the app asked of the device. |
| `phone.screenshot()` | A PNG of the screen (same machine as the simulator). |

Vitest adds the `phone` fixture (a new phone per test) and two matchers, `toSee(text | RegExp)` and `toHaveButton(name)`.
