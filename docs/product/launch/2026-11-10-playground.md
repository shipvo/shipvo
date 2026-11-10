# Launch kit: the Shipvo playground (Android and iOS phones in your browser)

Drafts for the owner to post. Every statement is from `docs/getting-started.md#try-it-in-your-browser-first` and `changes/1242-playground-ota.md`, `changes/1244-*.md`; no numbers beyond those are claimed.

Links: [docs](../../getting-started.md#try-it-in-your-browser-first), [playground](https://shipvo.dev/playground/), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

Try Shipvo before you install it. The playground runs a sample app on an Android phone and an iPhone side by side in your browser. Set device features, publish a signed update and roll it back, or show 1 to 12 phones. https://shipvo.dev/playground/

## LinkedIn post

You can try Shipvo without installing anything.

Open the playground and the sample app runs on an Android phone and an iPhone, side by side.

- Device API: set location, camera, biometrics, payment, notification and airplane mode and see the app react.
- Over-the-air updates: publish a signed update, stage it to 10% and then 100% of phones, crash it and watch the rollback.
- Many phones: show 1 to 12 phones, pick Android, iOS or both, and copy a link to share your setup.

The signature result, cohort counts and crash-loop threshold on the update panel come from the real signer, verifier, cohort bands and runtime code.

https://shipvo.dev/playground/

## Show HN-style description

shipvo.dev/playground runs the Tide & Tackle sample app on Android and iOS phone skins in the browser, with three panels: Device API, over-the-air updates (signed update, 10% and 100% cohorts, crash-loop rollback, values recorded at build time from the real signer, verifier and runtime code) and Many phones (`?phones=6&mix=both&dark=1#many`). No install. Docs: https://shipvo.dev/docs/getting-started/#try-it-in-your-browser-first

## 30-second demo script (Video Studio)

1. 0-5 s: Open shipvo.dev/playground; Android and iPhone side by side.
2. 5-12 s: Device API panel: turn on airplane mode; both phones show the result.
3. 12-21 s: Over-the-air panel: publish, stage to 10% and 100%, crash, rollback.
4. 21-27 s: Many phones: set 6, mix both, press Copy link.
5. 27-30 s: Caption: "Try it first. shipvo.dev/playground".
