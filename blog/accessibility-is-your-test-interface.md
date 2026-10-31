---
title: Name your buttons: accessibility is the best test interface a mobile app has
date: 2026-10-31
order: 6
author: Hans Ade
tags: Guides, Testing, Agents
seo_title: Accessibility labels as a mobile test interface
summary: The labels that let a screen reader user find your button are the same ones a test, or an AI assistant, uses to find it. Why that is a good thing to build on, and what it cannot replace.
---

There is a kind of test selector everyone eventually regrets: the test id, a name added to a component only so a test can find it. It tells you nothing about whether a person can use the screen.

## Two documents that agree

React Native's accessibility docs say that when a view is accessible, "it is a good practice to set an `accessibilityLabel` on the view, so that people who use VoiceOver or TalkBack know what element they have selected." A screen reader "will verbalize this string when the associated element is selected." Roles do similar work: `accessibilityRole` "communicates the purpose of a component to the user of assistive technology."

Playwright, the browser testing library, makes the same bet. Its `getByRole` locator "allows locating elements by their ARIA role, ARIA attributes and accessible name," and its `ariaSnapshot` captures the accessible structure of an element as YAML.

Both reach the same idea from different sides: the accessible name and role are a stable, meaningful way to refer to a control.

## What Shipvo does with it

The simulator gives a test, or an assistant, the screen as that structure:

```text
- heading "Delivery and payment" [level=1] [ref=e30]
- button "Use my location" [ref=e38]
- radio "Mobile money" [ref=e41]
- button "Place order" [ref=e44]
```

A test taps `"Place order"`, not a coordinate and not an id. If the label is missing or vague, the test cannot find the control, and the same screen would confuse a screen reader user. So a failing test is often a real accessibility bug, found early.

## What to do about it

- Give every touchable element a label that makes sense out of context. "Add" is worse than "Add Chrome Spoon to cart."
- Use the right role. A control that behaves like a button should say it is one.
- Treat "the assistant could not find it" as a finding, not a flaky test.

## What it does not replace

This is a useful proxy, not a substitute. React Native's own docs are careful here: VoiceOver is not available in the iOS simulator, Android emulators do not have TalkBack installed by default, and "it's always best to test with a device." Shipvo's tree shows the names and roles a screen reader would use. It does not tell you how VoiceOver or TalkBack speak them, in what order, or whether focus behaves. Keep a real screen reader pass in your release checklist.

## Sources

- React Native, [Accessibility](https://reactnative.dev/docs/accessibility).
- Playwright, [Locator API](https://playwright.dev/docs/api/class-locator): `getByRole`, `ariaSnapshot` and auto-waiting.
- Shipvo, [Agents and Shipvo apps](/docs/agents/#what-the-tree-shows-and-hides-on-purpose).
