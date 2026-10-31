# Slow, brittle, expensive: the test pyramid, and where a phone simulator fits

> Martin Fowler's test pyramid says to run few tests through the UI because they are slow, brittle and expensive. That advice still holds. Here is how to use a simulator without breaking it.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/slow-brittle-expensive/

If you have written end-to-end tests for a mobile app, you already know the feeling the test pyramid describes. They are the tests that catch the bugs that matter, and the tests you trust least.

## What the pyramid says

Martin Fowler's note on the test pyramid, from 2012, is blunt about UI-driven tests. "Testing through the UI like this is slow, increasing build times." And: "Most importantly such tests are very brittle." In short, "tests that run end-to-end through the UI are: brittle, expensive to write, and time consuming to run."

His conclusion is the shape that gives the idea its name: many more low-level tests, far fewer through the UI. You should do much more of your automated testing through unit tests.

## Why that is harder on mobile

On a phone, every one of those costs is larger. An emulator takes minutes to boot. An iOS simulator needs a Mac. Tests that depend on pixel positions break when a button moves. So teams write too few UI tests, and the bugs that live between screens, in navigation, payments and permissions, ship.

## What changes with a simulator that reads the screen

A Shipvo test does not click pixels. It reads the screen as an accessibility tree and acts on names, such as `phone.tap("Place order")`. That removes the main source of brittleness, since moving a button does not break it. It runs headless on a plain Linux runner, so there is no emulator boot and no Mac. It does not make the tests fast enough to put at the base of the pyramid, and it is not meant to.

## How to use it without breaking the pyramid

- **Keep your unit tests.** Logic that can be tested without a screen should be.
- **Write a few journeys, not hundreds.** Cover the paths that lose money or users when they break: sign-in, purchase, a declined payment, a denied permission.
- **Test the failure paths.** They are the ones people skip. The simulator can decline a payment, deny the camera, or go offline on request.
- **Keep a short pass on a real device** before a store release, for what a simulator cannot see.

This repository follows its own advice. The CI runs two typed tests against the sample shop: a full purchase, and a declined payment that must not place an order. That is the whole UI layer, on purpose.

```ts
test("a declined payment places no order", async ({ phone }) => {
  await phone.device.set({ payment: { nextResult: "decline", pin: "1234" } });
  await phone.tap("Place order");
  await phone.tap("Confirm payment");
  await phone.waitFor("Payment declined");
  expect(phone).not.toSee(/Order TT-\d+ placed/);
});
```

## Sources

- Martin Fowler, [Test Pyramid](https://www.martinfowler.com/bliki/TestPyramid.html), 1 May 2012.
- Shipvo, [Test your app in CI](https://shipvo.dev/docs/testing/).
