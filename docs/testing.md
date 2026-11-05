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
- **Push notifications.** Grant `permissions: { notifications: "granted" }` first (without it nothing is delivered). Then `phone.notifications.receive(...)` and `phone.notifications.tap()`, and assert the deep link lands on the right screen.
- **Deep links.** `await phone.openUrl("myapp://item/3")`, then assert the right screen. The app must listen with `onUrl` from `@shipvo/device`; if it does not, `openUrl` throws a `PhoneError` with code `no_url_listener`. The MCP tool is `open_url`. On a phone, `onUrl` fires only for URLs that arrive while the app runs; for a URL that launched the app, read `Linking.getInitialURL()`.
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
| `phone.openUrl(url)` | Open a deep link in the app. Throws `no_url_listener` if the app does not listen. |
| `phone.notifications.receive({...})` / `tap(id?)` / `notifications()` | Push notifications and the shade. Grant `notifications` permission first, or nothing is delivered. `receive` returns whether it was delivered. |
| `phone.deviceLog()` | What the app asked of the device. |
| `secret(name)` | Read `SHIPVO_TEST_<NAME>`; throws if unset. Masked as `***` in errors. |
| `phone.screenshot()` | A PNG of the screen (same machine as the simulator). |

Vitest adds the `phone` fixture (a new phone per test) and two matchers, `toSee(text | RegExp)` and `toHaveButton(name)`.

## Logins and other secrets

Do not type a password into a test. Read it from the environment instead.

```ts
import { secret } from "@shipvo/test";
await phone.type("Password", secret("PASSWORD"));
```

`secret("PASSWORD")` reads `SHIPVO_TEST_PASSWORD`. If it is not set, the test fails with an error that names the variable. In plain-language tests use a placeholder:

```
type "{secret:PASSWORD}" into "Password"
```

The placeholder is resolved only when the step runs. The step text, `--repair` diffs and compiled tests keep `{secret:PASSWORD}`. Error messages and `--report` files show `***` in place of any secret value that was read. Masking is by exact value, so a secret that the app shows in a changed form (for example upper-cased) is not masked. Values shorter than 4 characters are never masked, and masking lasts for the process that read the secret. `{secret:NAME}` is resolved only in `type` steps, not in `see` or `wait for`.

In GitHub Actions, map a repository secret to the variable:

```yaml
- run: npx shipvo test
  env:
    SHIPVO_TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
```

## Repair broken steps

Plain-language tests live in `tests/*.steps`. When a label changes, run:

```bash
npx shipvo test --repair          # shows a unified diff for each broken step
npx shipvo test --repair --write  # saves the diff
```

A step is repaired only when one element with the same role has the closest name. The repair changes the target and keeps the rest of the step. If two elements are equally close, or the role changed, the step stays as written and the candidates are listed. Steps are never deleted, skipped or loosened. Without `--write` nothing on disk changes. In code: `proposeRepair(step, screen)` from `@shipvo/test`.

## Results file for CI agents

```bash
npx shipvo test --report shipvo-report.json --release 42
```

Writes one JSON file, whether the run passes or fails. The exit code is the same as without `--report`.

```json
{
  "app": "tide-and-tackle",
  "commit": "9262005…",
  "release": "42",
  "time": "2026-11-05T10:00:00.000Z",
  "parityLimits": ["The simulator runs the app's web build …"],
  "flows": [
    {
      "name": "tests/cart.steps",
      "status": "failed",
      "steps": [{ "kind": "tap", "target": "Add to cart", "line": 2 }],
      "failedStep": { "kind": "tap", "target": "Add to cart", "line": 2 },
      "message": "nothing on screen matches \"Add to cart\""
    }
  ]
}
```

- `app` is `appId` from `shipvo.json`, or `null`.
- `commit` is `GITHUB_SHA`, else `git rev-parse HEAD`, else `null`.
- `release` is the value of `--release`, else `null`. The CLI does not record the last publish yet.
- Each flow is one `.steps` file. `status` is `passed` or `failed`. `failedStep` and `message` are `null` when it passed.
- `parityLimits` is the same list the explore report prints.
- The file holds no keys or tokens.

## Markdown report for issues and PR comments

```bash
npx shipvo test --report-md shipvo-report.md --release 42
gh issue create --title "Shipvo flows failed on release 42" --body-file shipvo-report.md
```

`--report-md` writes a Markdown file and nothing else; the CLI never calls GitHub. It can be used with `--report`. The file lists the release, the commit and the passed and failed counts. Each failing flow gets its steps, the failed step, the error and any screenshot file names, then the parity limits. A run where every flow passes gets a short "all flows passed" summary. Missing fields (no commit, no release, no screenshots) are shown as "unknown", "not set" or left out. Text is copied from the report as is, so values masked there stay masked.
