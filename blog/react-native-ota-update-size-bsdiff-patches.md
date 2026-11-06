---
title: How big is a React Native OTA update? Bundle diffing, measured
date: 2026-11-05
modified: 2026-11-06
order: 25
author: Shipvo team
tags: Guides, OTA
seo_title: React Native OTA update size: bsdiff patches measured
summary: A full Hermes bundle is 1.5 to 2 MB. A bsdiff patch was 64 KB in our Android run. Measured sizes, why the first update is bigger, and what to check.
---

Every over-the-air (OTA) update has a size. On a 2 GB phone on a slow connection, that size decides whether the update arrives today or after the user closes the app. This post covers React Native OTA update size: what a full bundle weighs, what a binary patch saves, and what we measured in this repo.

## What an OTA update actually downloads

An OTA update replaces the JavaScript part of your app. With Hermes, that part is a single bytecode file. For our sample app, Tide and Tackle, the file is between 1.5 and 2 MB:

- Android: 1.57 MB ([spike results](/docs/spike-results/)).
- iOS Simulator: 1,996,082 bytes in the most recent run ([spike results, iOS patch size](/docs/spike-results/#ios-patch-size-and-patch-apply-time)).

A small app has a small bundle. A large app has a larger one. Either way, most releases change a few screens, so sending the whole file again wastes data.

## How a patch works

A binary diff tool compares the old bundle with the new bundle and writes down only the differences. The phone holds the old bundle, downloads the difference and rebuilds the new bundle. Shipvo uses [bsdiff](https://www.daemonology.net/bsdiff/), a common tool for this.

Rebuilding creates a risk: if the phone patches the wrong base, it gets a broken bundle. So the patch is guarded in three ways:

1. A patch is used only if its `from_sha256` equals the hash of the bundle the phone runs now (or the bundle embedded in the app).
2. The rebuilt bundle's size and hash are checked against the signed release pointer.
3. If any check fails, the phone downloads the full bundle instead.

The full rules are in step 9 of the [adapter contract](https://github.com/shipvo/shipvo/blob/main/docs/adapters.md). The point is that a patch can only make an update smaller. It cannot make it less safe, because the result is verified like a full download.

## What `shipvo publish` does

When you publish, the CLI builds patches from recent releases and from each app shell's embedded bundle:

```bash
shipvo publish --max-bases 6
```

`--max-bases` sets how many older releases to patch from (the default is 6). The CLI prints the result, for example `patches: <hash>=64.0KB`. `shipvo publish` builds the patches itself, with nothing else to install. A patch is kept only if it is under 60% of the full bundle. Otherwise the phone gets the full file.

A first release has nothing to patch from, so `shipvo publish --dry-run` reports full bundles only. See the [getting started guide](/docs/getting-started/) for the dry-run layout.

## What we measured

These numbers come from our own runs. Nothing here is estimated.

| Case | Patch | Full bundle | Where measured |
| --- | --- | --- | --- |
| Android, release 7 from release 6 (content change) | 64 KB | 1.57 MB | [spike results](/docs/spike-results/), 30 Oct 2026 |
| Android, first update after a fresh install | 291 KB | 1,530 KB | [spike results](/docs/spike-results/), 30 Oct 2026 |
| iOS Simulator, first update from the embedded bundle (median of 3 runs) | 83,999 bytes | 1,996,082 bytes | [Actions run 42087991990](https://github.com/shipvo/shipvo/actions/runs/42087991990), 5 Nov 2026 |

On Android, the 64 KB patch was downloaded, patched and verified in 913 ms. That is 96% smaller than the full bundle for that release. The same file also lists patch sizes of 17 to 112 KB across bench tests.

On the iOS Simulator, the median time from the last byte to a healthy app was 573 ms. That includes the reload. The control plane ran on the same machine, so this shows the runtime's own cost and not a mobile network.

Read these with care. They are one sample app, one Android phone (a Redmi 9A) and one simulator image. Your bundle will differ. The useful part is the method: publish two releases, read the patch size the CLI prints, and compare it with your full bundle.

## Why the first update is bigger

The 291 KB figure is the one most guides skip. On a fresh install, the phone has only the bundle that shipped inside the app. That bundle was built separately from your OTA bundles, so more bytes differ. The patch against it is larger than a patch between two OTA releases.

After that first update, every patch is between two OTA releases, which is where the 64 KB steady-state figure comes from. The iOS run shows the same shape.

## Hermes makes diffing harder

Hermes bytecode is not like text. Other teams have written about this. The maintainer of react-native-update says that Hermes re-sorts its string table on each compile and stores absolute offsets, so a one-line change can move many bytes ([DEV Community](https://dev.to/sunnylqm/why-hermes-bytecode-defeats-binary-diffing-and-how-we-got-a-one-line-ota-hotfix-down-to-34-kb-2cn2)). That is their analysis and their benchmark, and we have not reproduced it. We mention it because it explains why a "one-line" change does not give a "one-line" patch.

Expo added bundle diffing to EAS Update in SDK 55 and estimates smaller downloads ([Expo blog](https://expo.dev/blog/ship-smaller-ota-updates-bundle-diffing-comes-to-ota-updates-in-sdk-55)). We have not measured EAS Update, so we make no size comparison with it. If you compare tools, measure the same app, the same change and the same base.

## The smallest update is not code

Our spike notes name one more lever. Copy, prices and images do not need a new bundle at all. If they are sent as data from a content system, an edit takes a few kilobytes. Shipvo's per-app `/admin` is aimed at this. We have not published a measurement for it yet, so treat it as direction, not a result.

## A checklist for any OTA tool

- Does it send patches, and against which base? The previous release only, or several?
- What does a fresh install download first?
- Is the patched result verified against a signed hash?
- What happens when the patch is missing or fails? You want a full-bundle fallback.
- Has the vendor published sizes with the device, the app and the date?

## Next step

Try it on your own bundle. [Build your first Shipvo app](/docs/getting-started/), publish twice, and read the patch line. If you are moving from CodePush, the [migration guide](https://github.com/shipvo/shipvo/blob/main/docs/migrate-from-codepush.md) covers where patches fit. To see what happens when an update goes wrong, read [how to roll back a bad React Native OTA update](/blog/roll-back-a-bad-react-native-update/).
