---
title: Test airplane mode: what offline-first means for the apps you ship
date: 2026-10-31
order: 15
author: Hans Ade
tags: Guides, Testing
seo_title: Test offline mode in React Native apps
summary: Android's guidance on offline-first apps starts from a plain fact: connectivity comes and goes. How to test the moments your app has no network, and what a simulator can and cannot show.
---

A test suite that always has a network is testing a phone that does not exist.

## The premise

Android's guide to building an offline-first app defines the term: "An offline-first app is an app that is able to perform all, or a critical subset of its core functionality without access to the internet." It states the reason without drama: "Network availability is not always guaranteed. Devices commonly have periods of spotty or slow network connection," including "limited internet bandwidth" and "transitory connection interruptions, such as when in an elevator or a tunnel."

The recommended architecture follows: "The local data source is the canonical source of truth for the app. It should be the exclusive source of any data that higher layers of the app read. This ensures data consistency between connection states."

You do not have to go fully offline-first to take the lesson. The app should behave sensibly when the network goes away mid-task, not only at launch.

## The moments that break

- The network drops between "Place order" and the confirmation, and the user does not know whether the order went through.
- The app launches with no network and shows a blank screen instead of the last known content.
- A user edits something offline and the change is lost without a word.
- A retry creates a duplicate.

These are logic and flow bugs, which is exactly what a simulator can find, and they are rarely tested because breaking the network on a real device is awkward.

## Testing it in Shipvo

The simulated phone has a network switch (`online`). The wording the app shows is yours, so change the strings to match:

```ts
test("losing the network during checkout is reported, not silent", async ({ phone }) => {
  await phone.tap("Place order");
  await phone.device.set({ online: false });
  await phone.tap("Confirm payment");

  await phone.waitFor(/offline|connection/i);
  expect(phone.sees(/Order TT-\d+ placed/)).toBe(false);
});
```

Pair it with the last check in an assistant session: `end_session` reports what the app actually sent to its backend, so you can confirm that the failed attempt did not create an order, and that a retry creates exactly one.

You can ask an assistant to explore it too: "Open the app, add an item, then take the phone offline and finish checkout. Tell me what the app says." See [Test with an assistant](/docs/test-with-an-assistant/).

## What a simulator cannot tell you

It switches the network on and off. It does not reproduce a flaky 2G connection, packet loss, captive portals or an operating system suspending your app in the background. Test slow and lossy networks on a real device with network throttling, and decide from your users' conditions how much of that you need.

## Sources

- Android Developers, [Build an offline-first app](https://developer.android.com/topic/architecture/data-layer/offline-first).
- Shipvo, [Test your app in CI](/docs/testing/).
