---
title: Google Play's 12 testers for 14 days rule: how to pass it as a solo founder
date: 2026-11-06
order: 26
author: Shipvo team
tags: Guides, Store
seo_title: Google Play 12 testers for 14 days: how to pass it
summary: New personal Google Play accounts need 12 testers opted in for 14 days in a row. The steps in Play Console, and how Shipvo Testers and one command help.
---

You built the app. It runs. Then Google Play tells you that you cannot publish it yet: a new personal developer account needs **12 testers opted in to a closed test for 14 days in a row** before you can apply for production access.

This post explains the rule, the exact steps, and where Shipvo helps. It is written for solo founders who do not have twelve friends with Android phones.

## What the Google Play 12 testers rule says

The rule is Google's, and it can change. Read [Google's help page](https://support.google.com/googleplay/android-developer/answer/14151465) for the current wording. As we understand it today:

- It applies to **personal** developer accounts. Organization accounts skip it.
- Personal accounts made before 13 Nov 2023 skip it.
- You need at least 12 testers opted in to a **closed test**, and they must stay opted in for 14 days in a row.
- If the count drops below 12, the clock starts again.
- Apple has no such rule.

So the plan has a built-in wait of two weeks. Start early, because nothing else you do can shorten it.

## Do you need to go through this at all?

Check before you recruit anyone. `shipvo store setup` asks one question, whether you have a registered company, and prints your plan:

```bash
shipvo store setup --company no
```

This is the output for a founder with no company (run in this repo, trimmed):

```text
Google Play: personal account. Personal account (25 USD once). Google Play needs at least 12 testers opted in to a closed test for 14 days in a row before you can apply for production.
  - play-account: Open a Google Play personal account (wait: Identity verification.)
  - play-closed-test: Start the closed test with 12 testers (wait: 14 days in a row with at least 12 testers. If the count drops below 12 the clock resets.)
  - play-apply: Apply for production access
  - play-review: Production review (wait: Google review, up to about 7 days.)
  - play-live: Live on Google Play
```

With a registered company you would get an organization account and no tester step. The command writes `store-plan.json`, and `shipvo store status` shows what to do next. Nothing is uploaded and no store is contacted. The full table of cases is in the [store guide](/docs/store/).

## The steps in Play Console

`shipvo store testers` prints the checklist for your app. Give it your package name:

```bash
shipvo store testers --package com.example.shop
```

```text
Get your 12 testers for com.example.shop (closed track "alpha"):

  1. In Play Console, open Testing > Closed testing and create a track (or use the default one).
  2. Upload your first build by hand. Play does not allow the API to do the first upload.
  3. Add testers as Google Groups: shipvo-testers@googlegroups.com, plus a group of your own people. ...
  4. Share your opt-in link: https://play.google.com/apps/testing/com.example.shop
  5. Join Shipvo Testers yourself (https://groups.google.com/g/shipvo-testers) and test other founders' apps. ...
  6. Keep at least 12 testers opted in for 14 days in a row. ...
```

Add `--json` if you want the same steps as data for a script or an AI agent.

The step people trip on is number 2. **The first upload of a new app must be done by hand in Play Console.** The Play API will not do it, and so neither will we. You need a signed Android build for that upload. Expo's EAS or your own CI can make one; Shipvo does not build the native binary.

## Where to find 12 people

This is the hard part, and no tool removes it. Realistic sources:

- Friends and family with Android phones. Ask for a specific favour: opt in, install, keep it for two weeks.
- Your own users or newsletter readers, if you have them.
- Other founders in the same position. They need 12 testers too, so a swap is fair.

That last one is why we run **Shipvo Testers**, a Google Group of founders who test each other's apps. Anyone can join at [shipvo.dev/testers](https://shipvo.dev/testers/). Members cannot see each other's emails, and only managers post. Add `shipvo-testers@googlegroups.com` to your closed track as a group and members can opt in.

We cannot promise how many people will opt in to your app. It works only if members test each other's apps, so open the ones others share, opt in, and keep them installed for the full 14 days.

## Add the group with one command

You can add the group in Play Console by hand. Or give the CLI your own Play service account key (it needs access to the app in Play Console):

```bash
shipvo store testers --package com.example.shop --play-key play-key.json
```

It opens a Play edit, reads the groups already on the track, adds Shipvo Testers to them, and commits. It never removes a group. The key is read once and not stored. Without `--play-key`, no network call is made, which is why the earlier commands are safe to run anywhere.

## Share the opt-in link and keep the count up

Testers need your opt-in link: `https://play.google.com/apps/testing/<your package name>`. They open it, opt in, and install.

Then watch the count. Two habits help:

1. **Over-recruit.** Aim for 15 to 20. Some people will drop out, and a dip below 12 resets the clock.
2. **Ship them something real.** Testers who see a working app, and a few updates, tend to stay installed. Use the wait to fix bugs. Your testers' bug reports are useful input, and you can turn each into a regression test with [a coding agent driving the simulator](/blog/your-assistant-can-test-your-app/).

Track the wait in your plan:

```bash
shipvo store status --mark play-closed-test --as waiting
```

## Use the 14 days well

Two weeks is a long time to stand still. Things you can do while the clock runs:

- Prepare store listing assets. `shipvo store screenshots` renders store-sized images from the simulator and says plainly that they are simulator renders, not the native UI. See the [store guide](/docs/store/).
- Start your Apple account in parallel. Apple has no tester rule, but identity checks take time.
- Set up update safety, so fixes reach testers without a new store review: [signed over-the-air updates](/blog/who-signs-your-updates/) with [staged rollouts](/blog/staged-rollouts/). Check the [store rules for OTA](/blog/ota-updates-and-the-app-store-rules/) first.

## What this does not do

Honest limits:

- It does not shorten the 14 days.
- It cannot make the first upload for you.
- It cannot guarantee 12 testers will opt in.
- Google decides whether to grant production access. After the closed test you apply, and review can take up to about a week.

## Next steps

- Follow the step-by-step [Get your 12 testers tutorial](/learn/get-your-12-testers/), with a 1 minute 42 second video.
- Read the [store guide](/docs/store/) for `setup`, `status`, `screenshots` and `testers`.
- Join [Shipvo Testers](https://shipvo.dev/testers/) and test someone else's app this week.
