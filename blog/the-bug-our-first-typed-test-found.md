---
title: The first typed test we wrote for our own sample app found three bugs in one session
date: 2026-10-31
author: Hans Ade
order: 2
tags: Stories, Testing, Engineering
seo_title: Three bugs our first typed test found
summary: We built @shipvo/test so developers can write Playwright-style tests against the simulator, then pointed it at our own sample shop. Three bugs came out before we had a green run, and all three were in our own tooling. What they were and what we changed.
---

We shipped `@shipvo/test` this week: typed end-to-end tests that run your app in the headless simulator, from Vitest or any runner. The idea is that a pull request should run your real app flows, the way a customer would, before a human or a phone ever sees the change.

The first real test we wrote was for our own sample app, Tide & Tackle, a small shop with a cart, delivery slots and mobile money. A purchase flow: scan a code, set a location, pay by mobile money, confirm with a fingerprint, type a PIN, see the order confirmation.

It found three bugs before we had a green run. All three were in our own tooling, none in the sample app.

## Bug 1: "NaN items"

The test seeded the cart so it could start at checkout. The sample app showed "NaN items" and a blank total.

The cause was a mismatch between two pieces of our own code. The MCP tool `open_app` accepted a cart shaped `{ id, qty }`. Tide reads `{ product_id, quantity }`. The seed passed straight through, Tide found neither field it expected, and the arithmetic on them came out as `NaN`.

Anyone who seeded a cart through an assistant would have hit the same thing. We found it because a test finally exercised it.

We fixed it on the MCP side: `seed_cart` now accepts either shape and normalises it. That shipped as `@shipvo/mcp` 0.0.5. The test package's own `seedCart` is deliberately loosely typed, because a sample app's cart is an app concern, not ours.

![The Tide and Tackle home screen with the cart at zero.](/img/tide-1.webp "Tide & Tackle at the start of a session: the cart reads 0. After the bad seed it read NaN items.")

## Bug 2: a blank screen right after a tap

Next, the test tapped a button and read the screen straight away. The tree was empty. A second later it was fine.

The simulator returned the tree before the app had re-rendered. A human never notices a 100 ms gap; a script that reads at once does, and it fails at random, which is the worst way for a test to fail.

The fix lives in the test client, where it belongs. After an action, `phone` waits for the screen to settle and refreshes once if it still looks empty, and `waitFor` retries instead of reading once. A test now says what it expects to see ("Payment declined") and the library waits for it, so you never write a sleep.

## Bug 3: the parser that did not like quotes

The third one was in our own accessibility-tree parser. Names containing a colon, such as `button "Notification: Order placed"`, come out of the simulator wrapped in YAML quotes, like this:

```text
- 'button "Notification: Order placed" [ref=e23]':
```

Our parser expected the line to start with a dash and a role. It skipped the quoted lines, so the notification was invisible to tests while plainly on screen. We now unwrap quoted lines before parsing, and there is a unit test for it.

## What the test looks like now

```ts
import { test, expect } from "@shipvo/test/vitest";

test("a declined payment places no order", async ({ phone }) => {
  await phone.device.set({
    payment:    { nextResult: "decline", pin: "1234" },
    biometrics: { enrolled: true, nextResult: "success" },
    location:   { latitude: 4.0225, longitude: 9.6967 },
  });
  await phone.tap("Place order");
  await phone.tap("Use fingerprint");
  await phone.type("Mobile money PIN", "1234");
  await phone.tap("Confirm payment");

  await phone.waitFor("Payment declined");
  expect(phone).not.toSee(/Order TT-\d+ placed/);
});
```

It runs in this repository's CI on every push, on a plain Linux runner with no emulator, and in projects created with `shipvo init` it also gates the over-the-air publish: a failing test stops the release.

## What we took from it

A test you write against your own tooling is a different kind of test. The first bug taught us our two packages disagreed about a shape. The second showed the simulator and the test client needed to agree about when a screen is ready. The third showed our parser had never met a real notification.

If you write tests for your app, expect to find bugs in your app. If you write them for the tools, expect the same, and be glad. Read the [guide to testing in CI](/docs/testing/) to write your first one, or have an assistant [explore the app first](/blog/your-assistant-can-test-your-app/) and turn what it finds into tests.
