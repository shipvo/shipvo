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
- **Share sheet.** `Share.share({ message, url })` opens a sheet that lists the other installed apps and Copy, on Android and iOS. The MCP tool `share_to` picks an app; it receives the share through `onShare` or `getInitialShare` from `@shipvo/device`. Errors: `no_share_sheet`, `not_share_target`.
- **Lock and restart.** The phone frame has power and volume buttons. The MCP tools `lock`, `unlock` and `restart` do the same: `lock` shows the lock screen, `unlock` returns to the same screen, `restart` cold-starts the app and keeps storage. While locked, `tap`, `type`, `scroll` and `back` fail with `phone_locked`; `lock` twice fails with `already_locked`, and `unlock` on an unlocked phone fails with `not_locked`. `screenshot` while locked still shows the app, not the lock screen.
- **Notification shade and Control Center.** On the phone frame, pull down from the top: Android opens the shade (pull again for all tiles); on iPhone the right third opens Control Center and the rest Notification Center. MCP: `open_notifications`, `open_control_center`, `toggle_tile`, `dismiss_notification`. Tiles write the same device state as `set_device` (`wifi`, `mobileData`, `airplane`, `darkMode`, `dnd`, ...). Dark mode reaches the app's colour scheme in the headless simulator; in the browser frame it changes the device state only. Flashlight, auto-rotate and orientation lock only change device state in the browser frame too.
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

## What this catches

It catches what breaks in logic and flow: wrong screens, broken navigation, missing validation, mishandled permission answers, payment and notification handling, and regressions between releases. Every simulated device feature is checked against Android and iOS, and the results are published in [simulator vs device parity](parity-results.md). Run it on every commit to catch bugs early.

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

### Test accounts

For a login, name an account instead of typing its values:

```
log in as "buyer"
```

The step reads `SHIPVO_TEST_ACCOUNT_BUYER_USER` and `SHIPVO_TEST_ACCOUNT_BUYER_PASSWORD`. It types the user into the username or email field, the password into the password field, and taps the **Log in** or **Sign in** button. If a variable is not set, the step fails and the message names the variable, never a value. Both values are masked as `***` in step logs, `--report` files and errors. `shipvo explore --issues-dir` and the explore report mask the value of every `SHIPVO_TEST_*` variable (values of 4 or more characters).

In GitHub Actions, store the user and password as repository secrets and map them:

```yaml
- run: npx shipvo test
  env:
    SHIPVO_TEST_ACCOUNT_BUYER_USER: ${{ secrets.BUYER_USER }}
    SHIPVO_TEST_ACCOUNT_BUYER_PASSWORD: ${{ secrets.BUYER_PASSWORD }}
```

Use the same `env:` block on the `shipvo explore` step.

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

## Gate a rollout on tests

One CI job: build, test, publish to the first cohort, then promote only if the tests passed. Each step stops the job if it fails.

```bash
# gate-recipe:start
RELEASE=43   # the next release number; `shipvo status` shows the current one
npx shipvo sim --port 4545 > sim.log 2>&1 &
for i in $(seq 1 180); do curl -sf localhost:4545/app/ >/dev/null && break; sleep 1; done
npx shipvo test --report shipvo-report.json --release $RELEASE
npx shipvo publish --bands b0 --release $RELEASE
npx shipvo promote --to b1,b2 --report shipvo-report.json
# gate-recipe:end
```

Install Chromium first: `npx playwright install --with-deps chromium`.

1. `shipvo sim` builds the app and serves it in the simulator. The loop waits for `localhost:4545/app/` before the tests start.
2. `shipvo test --report --release $RELEASE` runs every flow and writes the results file, pass or fail. A failing flow gives a non-zero exit, so the job stops here.
3. `shipvo publish --bands b0 --release $RELEASE` builds, signs and publishes to the first cohort only. Use the same number as in step 2.
4. `shipvo promote --report` refuses to widen the release when the report has a failing flow for that release. The report's `release` must match the release being promoted. Otherwise promote warns that the report is stale and goes on. See [`shipvo promote`](cli.md#shipvo-promote).

Publish to b0 does reach the first cohort. Only `promote` is gated by the report.

A drift test (`packages/cli/test/docs-gate-recipe.test.ts`) checks that every `npx shipvo` command and flag in the block above appears in `shipvo` help.

## Markdown report for issues and PR comments

```bash
npx shipvo test --report-md shipvo-report.md --release 42
gh issue create --title "Shipvo flows failed on release 42" --body-file shipvo-report.md
```

`--report-md` writes a Markdown file and nothing else; the CLI never calls GitHub. It can be used with `--report`. The file lists the release, the commit and the passed and failed counts. Each failing flow gets its steps, the failed step, the error and any screenshot file names, then the parity limits. A run where every flow passes gets a short "all flows passed" summary. Missing fields (no commit, no release, no screenshots) are shown as "unknown", "not set" or left out. Text is copied from the report as is, so values masked there stay masked.

## Run on a real emulator or simulator with agent-device

`shipvo test --device agent-device` runs the same flows on an Android emulator, the iOS Simulator or a device through the optional [agent-device](https://github.com/callstack/agent-device) CLI. Shipvo Phone stays the default.

1. Install it: `npm i -D agent-device`.
2. Run: `npx shipvo test --device agent-device --platform ios`. Lumi works the same way: `npx shipvo lumi android --device agent-device`.
3. Or set `"device": "agent-device"` in `shipvo.json`.

In code: `await openApp({ driver: "agent-device", platform: "android" })`. If the CLI is missing you see `agent-device is not installed; npm i -D agent-device, or drop --device to use Shipvo Phone`. Set `SHIPVO_AGENT_DEVICE_BIN` to use a binary in another place. See [`@shipvo/test`](../packages/test/README.md).

## Troubleshooting

**`timed out waiting for "…"` followed by `Screen now:`.** The text never appeared. Read the screen printed under the message: the label may have changed, or the app may still be on the previous screen. Fix the step, or run `npx shipvo test --repair` to see a suggested fix for a renamed label.

**`--repair` lists candidates and changes nothing.** Two elements were equally close, or the role changed. Pick the right one and edit the step yourself. Repair never guesses.

**A login step fails in CI but works on your machine.** The secret is not set in CI. Add it as a repository secret with the same name you use in `secret(name)` or `{secret:NAME}` (see [Logins and other secrets](#logins-and-other-secrets)).

**`--device agent-device` does not run.** Install it with `npm i -D agent-device`, start an Android emulator or an iOS Simulator, then run the command again (see [Run on a real emulator or simulator](#run-on-a-real-emulator-or-simulator-with-agent-device)).

**Offline steps fail with `TypeError: Network request failed`.** That is correct: with the network off the app's requests fail as they do on a phone. Check that the app shows its offline message ([Device API](device-api.md#network)).

## Next steps

- [Check every pull request](ci-check.md): run these tests on each PR.
- [Gate a rollout on tests](#gate-a-rollout-on-tests) before a release reaches phones.
- [Agents](agents.md): turn an assistant's session into a test with `export_test`.
- [Device API](device-api.md): what the simulator can fake (camera, location, payment, network).
