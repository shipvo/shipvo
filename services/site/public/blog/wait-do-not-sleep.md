# Wait, do not sleep: how to write mobile tests that do not flake

> A test that sleeps for a second is a test that fails on a slow day. Wait for what you expect to see instead, and make the failure message tell you what the screen actually showed.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/wait-do-not-sleep/

Almost every flaky UI test has the same cause: the test and the app disagree about when something has happened. The test looks, the app is not ready, and the test fails on a run that would have passed a moment later.

## Why sleeping is the wrong fix

The instinct is to add a delay: tap, wait a second, check. The delay is either too short, so the test is still flaky on a slow machine, or too long, so every test pays for it on every run. Neither tells you what you were waiting for.

## What the good tools do

Playwright describes locators as "the central piece of Playwright's auto-waiting and retry-ability," and says most actions wait for actionability checks before they run. You do not write the pause. You say what you want, and the tool keeps looking until it is there or time runs out.

Martin Fowler's description of UI tests as "brittle" is mostly about this: tests tied to timing and position break for reasons unrelated to the change being tested.

## How @shipvo/test handles it

A test states what it expects to see, and the library waits for it:

```ts
await phone.tap("Confirm payment");
await phone.waitFor("Payment declined");          // retries until it appears
await phone.waitForGone("Processing payment");    // or until it disappears
```

`waitFor` takes an optional `timeout` (five seconds by default) and an `interval`. When it times out, the error does not just say "not found." It carries the last screen, so the failure message shows what the phone was actually showing:

```text
timed out waiting for "Payment declined"

Screen now:
- heading "Confirm with fingerprint" [ref=e12]
- button "Use fingerprint" [ref=e13]
```

That turns a mystery failure into a bug report you can read.

## The first flake we fixed in our own tool

Our own first typed test hit this. A tap returned and the next read saw an empty tree, because the app had not yet re-rendered. The fix was in the client, not in the test: after an action, the phone waits for the screen to settle and refreshes once if it still looks empty. [We wrote up the full story](https://shipvo.dev/blog/the-bug-our-first-typed-test-found/).

## Rules of thumb

- Never write a fixed sleep. Wait for the thing you expect.
- Assert on what a person would see, not on internal state.
- Make failures explain themselves. A test that fails with the screen attached is cheaper to fix.
- If a test is still flaky, the app may have a real race condition. Look at it before you retry.

## Sources

- Playwright, [Locator API](https://playwright.dev/docs/api/class-locator): auto-waiting and retry-ability.
- Martin Fowler, [Test Pyramid](https://www.martinfowler.com/bliki/TestPyramid.html).
- Shipvo, [`@shipvo/test`](https://shipvo.dev/docs/test/).
