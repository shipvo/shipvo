---
title: Google Play's 12 testers for 14 days rule: how to meet it without guessing
date: 2026-11-06
order: 26
author: Shipvo team
tags: Guides, Store
seo_title: Google Play 12 testers for 14 days: how to pass it
summary: New personal Google Play accounts need 12 opted-in testers for 14 days in a row. The steps, the traps, and the Shipvo commands and community that help.
---

You built the app. It works. Then Google Play tells you that you cannot publish to production yet. You need 12 testers, opted in to a closed test, for 14 days in a row.

This post explains the rule, the steps in the right order, the mistakes that reset the clock, and what Shipvo gives you for it. It is written for founders who have never opened Play Console, and for developers who just want the checklist.

## What the Google Play 12 testers rule says

A new personal Google Play developer account must run a closed test before it can apply for production. The test needs at least 12 testers opted in, for 14 days in a row. This is Google's rule. Read [Google's help page](https://support.google.com/googleplay/android-developer/answer/14151465) for the current wording, because Google can change it.

Two groups skip it:

- Organization accounts.
- Personal accounts created before 13 November 2023.

Apple has no such rule. If you only ship to iPhones, this post is not for you.

## Do you actually need to do this?

Check before you recruit anyone. Shipvo can tell you. Run `shipvo store setup` and answer whether you have a registered company:

```bash
shipvo store setup --company no
```

Here is the output for a founder with no company (we ran this in this repo):

```text
Google Play: personal account. Personal account (25 USD once). Google Play needs at least 12 testers opted in to a closed test for 14 days in a row before you can apply for production.
  - play-account: Open a Google Play personal account (wait: Identity verification.)
  - play-closed-test: Start the closed test with 12 testers (wait: 14 days in a row with at least 12 testers. If the count drops below 12 the clock resets.)
  - play-apply: Apply for production access
  - play-review: Production review (wait: Google review, up to about 7 days.)
  - play-live: Live on Google Play
```

It also writes `store-plan.json`. Run `shipvo store status` later to see which step is next, and mark steps done with `--mark`. The App Store column of the same plan has no tester step. Details are in [Store details](/docs/store/).

If you do have a company, say `--company yes`. The plan then shows an organization account with no tester rule, and a D-U-N-S number is the thing to get first.

## How to get 12 testers on Google Play, step by step

Run this to print the steps for your own app:

```bash
shipvo store testers --package com.example.shop
```

It makes no network call. The output, from this repo:

```text
Get your 12 testers for com.example.shop (closed track "alpha"):

  1. In Play Console, open Testing > Closed testing and create a track (or use the default one).
  2. Upload your first build by hand. Play does not allow the API to do the first upload.
  3. Add testers as Google Groups: shipvo-testers@googlegroups.com, plus a group of your own people.
  4. Share your opt-in link: https://play.google.com/apps/testing/com.example.shop
  5. Join Shipvo Testers yourself and test other founders' apps.
  6. Keep at least 12 testers opted in for 14 days in a row.
```

A few notes on each step.

**The first upload is manual.** Play does not let any tool, including ours, make the first upload of a new app. You need a signed build. If you use Expo, [EAS](https://docs.expo.dev/build/introduction/) can build it, and Shipvo works with EAS builds.

**Testers are Google Groups.** Play lets you add a Google Group to a track, instead of typing 12 email addresses. Make a group for friends and family, and add it.

**The opt-in link matters.** A tester who is on the list has not yet joined. They must open the opt-in link and press the button. Only opted-in testers count.

## Where do the other testers come from?

This is the hard part. Most founders have five friends who will help, not twelve.

We run a free Google Group called **Shipvo Testers**. Founders add it to their closed track, and join it to test each other's apps. Anyone can join at [shipvo.dev/testers](https://shipvo.dev/testers/). Members cannot see each other's email addresses.

Two honest limits:

- It works because people test each other's apps. If you join and never test, you are taking from the group.
- We cannot promise how many people will opt in to your app, and we do not publish member counts.

Adding the group is a one-line change in Play Console. If you prefer the API, pass your own Play service account key:

```bash
shipvo store testers --package com.example.shop --play-key play-key.json
```

The command opens a Play edit, reads the groups already on the track, adds Shipvo Testers, and commits. It never removes a group. The key is read once and is not stored. Without `--play-key`, no network call is made.

## Mistakes that reset the 14-day clock

The count must stay at 12 or more for 14 days in a row. If it drops below 12, the clock starts again. Two common causes:

- **Testers opt out or uninstall.** Ask for more than 12, so a few drop-outs do not reset the clock.
- **Wrong track.** Opt-in links are per track. Check you shared the link for the closed test, not an internal one.

Treat the 14 days as setup time, not dead time. Use it to fill in your store listing and answer the Data safety form. `shipvo store details --dry-run` drafts those answers from your `shipvo.json`; see [Store details](/docs/store/).

## What to do after the 14 days

Apply for production access in Play Console. Google reviews the request, which usually takes up to about a week according to our plan output above, but Google sets the timing. Once you are live, later changes to your JavaScript can go out as signed updates with a staged rollout, so you do not wait on a store review for every fix. See [how staged rollouts work](/blog/staged-rollouts/) and [the OTA update and app store rules](/blog/ota-updates-and-the-app-store-rules/).

## Next step

Join the community at [shipvo.dev/testers](https://shipvo.dev/testers/), then follow the tutorial [Get your 12 testers](/learn/get-your-12-testers/). It takes about 15 minutes of setup, then 14 days of waiting. If you have not built the app yet, start with [build a mobile app without coding](/blog/build-a-mobile-app-without-coding/).
