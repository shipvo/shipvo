---
title: Try React Native over-the-air updates in your browser, with no install
date: 2026-11-10
order: 29
author: Shipvo team
tags: Guides, Updates
seo_title: Try React Native OTA updates in your browser
summary: Sign, stage and roll back an over-the-air update on Android and iOS phones in a browser tab. No install, no account. What each panel shows and where the numbers come from.
cover: browser
kicker: Try it in|your browser
---

Most tools for mobile apps ask for an install, an account and a build before you see anything. The Shipvo playground does not. Open one page and you get an Android phone and an iPhone running a sample shop, and you can sign an update, roll it out and watch it roll back.

This post walks through each panel and says what is real behind it. The page is at [shipvo.dev/playground](https://shipvo.dev/playground/). The reference is in the [playground docs](/docs/playground/).

## What you need to try over-the-air updates in a browser

A browser. That is all. The phone shows a shop called Tide and Tackle with three products. Tap **Add** and the line "Cart: 1 item" changes. It is the same sample app we use in [our tutorials](/learn/first-app/).

The bar above the phone switches between the Android look and the iPhone look. It also turns on dark mode, large text and right-to-left layout. Those three settings are where many apps break, and you can flip them in one click. We wrote about checking them in [dark mode, large text and RTL in React Native](/blog/test-dark-mode-large-text-and-rtl-in-react-native/).

## Sign, stage and roll back an update

Open **Signed updates** (or go straight to `/playground/#ota`). The panel walks through four steps on an Android phone and an iPhone.

1. **Publish.** A release for the sample app is signed with an Ed25519 key. The panel shows the public key and the signature.
2. **Stage to 10%.** The update reaches the first band of phones.
3. **Widen to 100%.** The update reaches every phone.
4. **Crash it.** The new version crashes on start, and the old version comes back.

The numbers on the panel are not typed in by hand. When the site is built, a script runs the real signer and verifier from `@shipvo/cli`, the cohort bands from `@shipvo/schema`, and reads the crash-loop limit out of the runtime source. The script is `services/site/playground-ota.mjs`. We ran it for this post. It printed:

| What | Value |
| --- | --- |
| Signature check on the release | valid |
| Signature check after one field is changed (`v2` to `v2-tampered`) | not valid |
| Cohorts reached at 10% | 100 of 1000 |
| Cohorts reached at 100% | 1000 of 1000 |
| Crash-loop limit | 3 starts in 60 seconds |
| Start where the old version returns | 4 |

Two things are worth reading closely.

**A changed update fails the check.** The signature covers the release document. Change one field and verification says no. A phone with the public key would refuse that update. This is the same check described in [who signs your updates](/blog/who-signs-your-updates/). The key in the playground is a fixed demo key made for the page. It is not a real signing key.

**The rollback rule is a count.** Each start of a new version is a trial start. After three trial starts that did not finish cleanly, the fourth start picks the previous version and records `crash_loop_revert:2`. The Android and iOS runtimes must agree on this number. The build script stops with an error if they do not, so the page cannot show a threshold that one platform lacks. For the full story of rollbacks, read [how to roll back a bad React Native update](/blog/roll-back-a-bad-react-native-update/).

## Set location, camera and payment on the phone

Open **Device API**. You can set:

- location
- camera
- biometrics
- payment
- notification
- airplane mode

The sample app shows each result. Deny the camera and the app shows what it does when it has no camera. Turn on airplane mode and you see the offline message. These are the paths real users hit and many test suites skip. The posts [the permission you never test](/blog/the-permission-you-never-test/) and [test airplane mode](/blog/test-airplane-mode/) explain why they matter. The full list of calls is in the [Device API docs](/docs/device-api/).

## See what an AI agent sees

Open **Agent tools**. It has a small console with four tools: `screen`, `tap`, `type` and `device_log`. `screen` returns the app as labelled elements, such as `button "Add to cart"`. `tap` and `type` act on those labels. You can run them by hand, or press **Watch Lumi** to see a test run on the sample app, on Android and iOS.

This is the same view an assistant gets over MCP when it tests your own app. If you have not met MCP, start with [what MCP is and why your app might speak it](/blog/what-mcp-is-and-why-your-app-might-speak-it/). The console is a browser version of the tools in the [agents docs](/docs/agents/).

## Show up to 12 phones and share the link

**Many phones** shows 1 to 12 Android and iOS phones side by side. Choose a count and a mix, turn on dark mode if you like, and select **Copy link**. Whoever opens the link sees your setup. You can also write the link yourself:

```text
https://shipvo.dev/playground/?phones=6&mix=both&dark=1#many
```

| Parameter | Values |
| --- | --- |
| `phones` | 1 to 12 (default 4) |
| `mix` | `android`, `ios` or `both` (default `both`) |
| `dark` | `1` for dark mode on every phone |

A link like this is handy in a bug report or a design review. Everyone looks at the same phones.

## What the playground is for

The playground runs a fixed sample app. It answers one question fast: what does Shipvo do? You see signed updates, staged rollout, rollback, device features and agent tools on Android and iOS, in the same tab.

When you want your own app, the step after the playground is one command:

```bash
npx shipvo run android
```

That puts your app on a phone in your browser. The post [see your React Native app on a phone in your browser](/blog/see-your-react-native-app-on-a-phone-in-your-browser/) shows it step by step.

## Next steps

1. Open the [playground](https://shipvo.dev/playground/) and press through the **Signed updates** panel.
2. Read the [playground docs](/docs/playground/) for every control and link parameter.
3. Build your own app in twenty minutes: [Build your first app](/docs/getting-started/).
4. Ship a real signed update with the [ship a fix tutorial](/learn/ship-a-fix/).
