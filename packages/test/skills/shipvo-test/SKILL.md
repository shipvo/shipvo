---
name: shipvo-test
description: Write and run end-to-end tests for a React Native app with @shipvo/test. Use when the project depends on @shipvo/test and you need a typed test, plain-language steps or a network mock.
---

# @shipvo/test

Headless end-to-end tests that run in the Shipvo simulator. No emulator needed.

```bash
shipvo sim          # simulator on http://localhost:4545
npx vitest run      # run typed tests
shipvo test         # run tests/*.steps
```

## A typed test

```ts
import { test, expect } from "@shipvo/test/vitest";

test("adds a lure to the cart", async ({ phone }) => {
  await phone.tap("Add 1 to cart");
  expect(phone).toSee("Cart");
  await phone.waitFor(/1 item/);
});
```

Other calls: `phone.type("Search", "popper")`, `phone.scroll("down")`, `phone.back()`, `phone.device.set({ location: { latitude: 4.05, longitude: 9.77 } })`.

## Plain-language steps

One step per line in `tests/<name>.steps`. `#` starts a comment.

```
tap "Add 1 to cart"
type "popper" into "Search" and press enter
scroll down
go back
see "X"
do not see "X"
wait for "Cart"
```

An unknown line fails with code `step_unparsed` and its line number. `shipvo test --repair` shows a diff for broken steps; add `--write` to save it.

## Mock the network

```ts
await phone.mockNetwork([{ url: /\/api\/products/, status: 503, body: { error: "down" }, delayMs: 300 }]);
await phone.clearNetworkMocks();
```
