---
title: Over-the-air updates and the app store rules: what you can change without a review
date: 2026-10-31
order: 3
author: Hans Ade
tags: Guides, OTA
seo_title: OTA updates and app store rules explained
summary: Both Apple and Google allow some code to change after review, and neither allows all of it. What the rules actually say, what that means for a React Native app, and where Shipvo draws the line.
---

The promise of an over-the-air update is simple: you fix a bug, and phones have the fix in minutes instead of waiting days for a store review. The question every team asks next is whether that is allowed. The short answer is that it is, within limits, and the limits are worth knowing exactly.

## What the rules say

Expo's guide to over-the-air updates summarises the relevant policies, and the wording is worth reading directly.

Apple's guideline 2.5.2 says apps "may not download, install, or execute code which introduces or changes features or functionality of the app." The Developer Program License Agreement, section 3.3.2, permits downloaded interpreted code only if it "does not change the primary purpose" of the app. Together, as Expo reads them, the rules allow you to fix the JavaScript that the reviewed app already runs, and do not allow you to add features the reviewer never saw.

Google's Device and Network Abuse policy says an app "may not download executable code (such as dex, JAR, .so files) from a source other than Google Play." The same policy says this "does not apply to code that runs in a virtual machine or an interpreter," and JavaScript in a React Native app counts as interpreted code.

## What that means in practice

An update can replace the JavaScript bundle and the assets bundled with it: screens, logic, styling, copy, images and fonts. Anything native needs a new binary and a store review: native modules, new native dependencies, permissions, the SDK or framework version, and native resources such as the icon and splash screen.

Neither store treats an over-the-air update as a way around review. The reviewed binary does not change, and each update still has to follow the same guidelines.

## How Shipvo draws the line

A Shipvo release is a JavaScript bundle and nothing else. It never carries native code. Each release also declares the oldest native shell it can run on (`min_shell_version`), so a phone that has not yet installed a newer binary keeps running a bundle built for it.

We checked this on a real phone rather than assuming it. On a Redmi 9A, installing a newer shell discarded a release built for the older one and booted the embedded bundle. A release that required the newer shell was refused by the older one and accepted by the newer one. The [spike results](/docs/spike-results/) have the timeline.

## A checklist before you ship an update

- Does this change add a feature the reviewed app did not have, or change what the app is for? If yes, ship a new binary.
- Does it need a new permission, native module or SDK version? If yes, ship a new binary.
- Is it a fix, copy, layout or content change to existing screens? That is the case over-the-air updates are for.

This is a reading of public policies, not legal advice, and policies change. Read the current text before you rely on it.

## Sources

- Expo, [Updates and rollouts: over-the-air updates](https://expo.dev/articles/updates-and-rollouts/over-the-air-updates), quoting Apple guideline 2.5.2, the Developer Program License Agreement section 3.3.2 and Google Play's Device and Network Abuse policy.
- Shipvo, [spike results](/docs/spike-results/) and [publishing](/docs/getting-started/#5-publish-over-the-air).
