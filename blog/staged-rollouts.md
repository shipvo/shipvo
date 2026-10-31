---
title: Seven days, a few percent, a pause button: how staged rollouts work on each platform
date: 2026-10-31
order: 10
author: Hans Ade
tags: Guides, OTA
summary: Apple and Google both let you release to a fraction of users first, and they do it differently. What each gives you, and how Shipvo's cohorts apply the same idea to over-the-air updates.
---

The cheapest way to survive a bad release is to make sure only a few people get it first. Both stores support that. The details differ enough to be worth knowing.

## Apple: phased release

According to Bitrise's write-up, Apple's phased release "expands user access from 1% to full availability over seven days," and developers cannot set the percentages themselves. You can pause it: "Apple allows mobile developers to pause the phased rollout for up to 30 days," after which the schedule resumes at its next phase.

## Google: staged rollout

Google works the other way round. A release manager sets the rollout percentage and adjusts it by hand. "You can modify the rollout percentage until it reaches 100% of your users," and Google does not impose a 30-day limit on finishing the rollout. The percentage typically defaults to 100%, so you have to choose a lower starting value on purpose.

## What both leave out

Store rollouts control who receives a new binary. They do not help with the update that follows ten days later, and a new binary is slow to correct, since fixing it means another build and another review.

## How Shipvo applies the idea to over-the-air updates

A Shipvo release is published per cohort band: `b0` is 1% of phones, `b1` is 10% and `b2` is everyone. The `--bands` flag chooses which bands a publish updates (the default is all three), so a release can be limited to the smallest band. `shipvo rollback --to 7` points every band back to release 7. Phones also protect themselves. A release that fails to boot three times is discarded and blocked, and the phone returns to the last good release without anyone doing anything. We tested that on purpose with a release that crashes at startup, and it recovered by itself.

This is a complement to the stores' tools, not a replacement. Use the store mechanisms for binaries and Shipvo's cohorts for the JavaScript updates between them.

## A simple routine

1. Release to the smallest cohort. Watch crashes and your key flow, such as completed orders, not only error counts.
2. Move up a step only when the numbers hold.
3. If they do not, roll back first and investigate second.
4. Test the rollback before you need it. A rollback you have never run is a guess.

## Sources

- Bitrise, [How to minimize the negative impact of a faulty release with a staged rollout](https://bitrise.io/blog/post/how-to-minimize-the-negative-impact-of-a-faulty-release-with-a-staged-rollout).
- Shipvo, [Publishing over the air](/docs/getting-started/#5-publish-over-the-air) and [spike results](/docs/spike-results/).
