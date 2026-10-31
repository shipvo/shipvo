---
title: The 1.09% line: what Google Play does to apps that crash
date: 2026-10-31
order: 4
author: Hans Ade
tags: Guides, Quality
seo_title: Google Play crash threshold: the 1.09% line
summary: Google Play publishes the crash and not-responding rates at which it may reduce your app's visibility. The numbers, the 28-day window that makes a bad release expensive, and what a simulator can and cannot do about it.
---

Most developers know that crashes are bad. Fewer know that Google Play sets numbers on it, publishes them, and says it may act on them.

## The thresholds

Android vitals defines "bad behavior thresholds." For the user-perceived crash rate, the overall threshold is 1.09% across devices, and for a single phone model it is 8%. For the user-perceived ANR (application not responding) rate, it is 0.47% overall and 8% per phone model. Google's page says: "To maximize your title's visibility on Google Play, please keep it under these thresholds."

The consequence is stated plainly: "If your app or game exceeds a bad behavior threshold, Play may reduce the visibility of your title. Play may also show users a warning on your store listing."

## Why one bad release lasts a month

The detail that matters most is the window. "Play uses the last 28 days of data to assess your app's quality." Play checks key indicators daily using a 28-day average, so a warning clears only once that average improves.

That is our reading of how the average behaves, not a claim Google makes: the days on which a broken release was live remain in the window until they age out. A release that crashes for a week and is fixed on day eight does not stop counting on day eight. The faster a bad release stops reaching phones, the fewer bad days sit in the window.

## Where a simulator helps, and where it does not

Be clear about what the Shipvo simulator is. It renders your app on the web and simulates the device, so it does not catch native crashes, which is what these thresholds measure. Use a real device, and crash reporting in production, for that.

What it does catch is the flow bug that makes users give up or hit an error path: a payment that cannot be declined cleanly, a permission denial that dead-ends, a cart that shows NaN. Those are the bugs behind a lot of bad reviews, and they are cheap to find before release. See [Test your app in CI](/docs/testing/).

## Where Shipvo helps after release

Two behaviours matter once a bad release is out.

- **Cohort bands.** Releases are published per band: 1% of phones, 10%, or everyone. A release limited to the smallest band reaches few people first.
- **Automatic revert.** On a real phone we published a release that crashes at startup on purpose. After three failed boots the phone discarded it, blocked it from coming back, and returned to the previous release by itself, with a cold start of 847 ms. `shipvo rollback` does the same on demand.

Neither replaces fixing the bug. Both shorten the time during which it counts against you.

## Sources

- Android Developers, [Android vitals](https://developer.android.com/google/play/vitals): bad behavior thresholds and the 28-day assessment window.
- Shipvo, [spike results](/docs/spike-results/): the crash-loop revert test.
