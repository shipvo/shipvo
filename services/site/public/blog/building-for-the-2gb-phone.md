# Building for the 2 GB phone: what we measured on a Redmi 9A

> Entry-level Android phones are the default in much of the world, and Google builds a whole edition of Android for them. What an over-the-air update costs on one, in kilobytes and milliseconds, measured on a real phone in Douala.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/building-for-the-2gb-phone/

It is easy to build an app on a fast laptop and a recent phone and call it done. A lot of your users are on something else.

## The phones Android Go is built for

Android (Go edition) is, in Google's words, "built for entry-level smartphones with less RAM than standard in higher-end devices." The minimum RAM rises with each release: 512 MB for Android 8.1 through 10, 1 GB for Android 11 and 12, and 2 GB for Android 13. Google's page also notes that when Go was announced in 2017, "entry-level phones accounted for more than half of all device shipments globally."

Apps built for standard Android "can technically run on Go," but with "significant built-in performance, network, and battery limitations." The page gives no specific size or memory targets, so you have to measure your own.

## What we measured

We tested on a Xiaomi Redmi 9A: a MediaTek Helio G25, 2 GB-class RAM, Android 11, on 4G in Douala. Everything below is real-device data, not simulated. The full table is in the [spike results](https://shipvo.dev/docs/spike-results/).

| What | Measured |
| --- | --- |
| Full bundle | 1.57 MB, downloaded in 1.4 to 2.0 s |
| Patch for a small content change | 64 KB (96% smaller than the full bundle), downloaded, patched and verified in 913 ms |
| First update after a fresh install | 291 KB, patched against the bundle inside the APK |
| Apply without restart | 240 to 302 ms |
| Cold start running an OTA bundle | 877, 905 and 878 ms |
| First launch after a fresh install | 1,051 ms |

We set our own bars in advance: updates under 100 KB in the steady state, and a cold start under a second on a low-end Android. Both passed, with one caveat that we published: the first update after install is larger than the bar, at 291 KB.

## Why the patch matters

On a 4G connection that may be metered, the difference between a 1.57 MB download and a 64 KB patch is real money and real waiting. Shipvo ships bsdiff patches from the version a phone already has, and verifies the signature, hash and size before applying anything.

## What a simulator cannot tell you

The Shipvo simulator runs your app on the web, so it says nothing about memory pressure, slow storage or a weak CPU. That is the reason this table comes from a phone and not from the simulator. If your users are on 2 GB devices, test on one before every store release, and treat what we measured as a floor to compare against, not a promise about your app.

Not measured yet: we have not run this on a physical iPhone, and the patch behaviour on iOS is not yet implemented.

## Sources

- Android Developers, [Android (Go edition)](https://developer.android.com/guide/topics/androidgo).
- Shipvo, [OTA on a 2 GB phone](https://shipvo.dev/docs/spike-results/).
