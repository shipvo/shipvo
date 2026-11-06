# How to roll back a bad React Native over-the-air update

> A bad over-the-air bundle keeps loading on every launch until you replace it. Three ways to stop it: limit who gets it, let the phone revert itself, and republish the last good release.

By Shipvo team, 2026-11-04. Canonical: https://shipvo.dev/blog/roll-back-a-bad-react-native-update/

You shipped a JavaScript update and it is wrong. Maybe a screen crashes. Maybe the checkout button does nothing. Phones are picking it up right now. What do you do?

This guide covers how to roll back a bad React Native over-the-air (OTA) update. It uses Shipvo's commands and numbers, and it points out where the idea applies to any OTA tool.

## Why a bad OTA update is hard to escape

An OTA update replaces the JavaScript bundle on the phone. The next launch loads the new bundle. If that bundle crashes at startup, the app may never get far enough to ask the server for a fix.

Guides for other tools describe the same trap: a broken bundle keeps loading on every launch until it is replaced, and a fix has to arrive before the crash or the phone needs its own fallback ([DEV Community, on EAS Update rollbacks](https://dev.to/davekurian/eas-update-rollback-plan-keeps-one-bad-bundle-from-stranding-your-users-2a3h)). Bitrise lists two choices: roll back to the last version that worked, or roll forward with a new fix ([Bitrise](https://bitrise.io/blog/post/react-native-ota-updates-best-practices)).

So a safe OTA setup needs three layers:

1. Fewer people get a bad release.
2. The phone protects itself.
3. You can undo the release for everyone with one command.

## Layer 1: let only a few phones get it first

Shipvo publishes each release per cohort band. `b0` is 1% of phones, `b1` is 10% and `b2` is everyone. Publish to the smallest band first:

```bash
shipvo publish --bands b0
```

If it looks healthy, publish again with the wider bands. If it does not, only a small share of phones saw it. Our post on [staged rollouts](https://shipvo.dev/blog/staged-rollouts/) compares this with Apple's and Google's store rollouts.

## Layer 2: the phone reverts itself

This is the layer that matters when the bundle crashes before the app can reach the network.

The Shipvo runtime counts failed boots. A release is marked healthy once the first screen renders. If a release fails to boot three times, the phone discards it, blocks that release number, and goes back to the last good release. It does not download the blocked release again.

In the spike, release 4 of the sample app threw an error at startup on purpose. After three failed boots the phone reverted to release 3 by itself. Cold start after the revert was 847 ms on a Xiaomi Redmi 9A (Android). The timeline and the raw numbers are in the [spike results](https://shipvo.dev/docs/spike-results/).

Two limits to be honest about:

- The numbers above are from Android.
- The phone only reverts crashes it can see at boot. A release that runs but does the wrong thing, such as a button that does nothing, is not a crash. For that you need layer 3.

## Layer 3: republish the last good release for everyone

Use this command when you know which release was good:

```bash
shipvo rollback --to 7
```

Say release 8 is bad and release 7 was fine. The command takes release 7's bundle from storage and publishes it again as a new release, release 9. It prints one plain sentence:

```text
Rolled back to the code of release 7 as new release 9. Next: shipvo status.
```

Add `--json` if a script or an agent reads the result. You then get one JSON line with `app`, `rolled_back_to_code_of`, `new_release` and more.

`rollback` publishes the old code under the next release number.

The command signs the new pointer with your signing seed, like a normal publish. Phones check the signature and the SHA-256 of the bundle before they apply it. A rollback is not a shortcut around verification. See [who signs your updates](https://shipvo.dev/blog/who-signs-your-updates/) for why that matters.

Useful flags. `--bands b0,b1` changes only the pointers for `b0` and `b1`; `b2` keeps its current pointer.

```bash
shipvo rollback --to 7 --bands b0,b1     # leave b2 alone
shipvo rollback --to 7 --platform android
```

`--platform` takes `android`, `ios` or `all`. The rollback fails with an error if the bundle for that release and platform is not found. Today there is no dry run for `rollback`, so check the release number twice before you press enter.

## A short incident checklist

1. **Stop the spread.** If the bad release is only in `b0`, do not publish to `b1` or `b2`.
2. **Pick the last good release number.** Use the release number you recorded when you published it. Do not guess.
3. **Run `shipvo rollback --to <n>`.** Add `--bands` if only some bands got the bad release.
4. **Open the app on a test phone or in the [simulator](https://shipvo.dev/docs/getting-started/).** `open_app("myshop@latest")` opens the exact release phones run, so you can confirm that the old behaviour is back.
5. **Fix forward.** Write a test that fails on the bad change, fix it, and publish as a normal release. A rollback buys time. It does not fix the bug.

## What to ask any OTA tool

Whatever you use, ask these before you need them:

- Does a phone revert on its own after repeated boot failures? How many?
- Does it remember the bad release so it is not downloaded again?
- Can you limit a release to a small share of users?
- Is a rollback signed and verified like any release?
- Has the vendor published a measured revert, with the device and the numbers?

The last one is where most pages stop at a claim. Ours is the crash-loop revert row in the [spike results](https://shipvo.dev/docs/spike-results/), with the device and timings. If you are leaving CodePush, see [a CodePush alternative after App Center](https://shipvo.dev/blog/a-codepush-alternative-after-app-center/) for the full checklist. For how OTA fits store policy, read [OTA updates and the app store rules](https://shipvo.dev/blog/ota-updates-and-the-app-store-rules/).

## Next step

Build a sample app and practise a rollback before you need one: [Build your first Shipvo app](https://shipvo.dev/docs/getting-started/). Publish two releases, break the second, and run `shipvo rollback --to 1`. The whole loop takes a few minutes.

Related: [how big is a React Native OTA update](https://shipvo.dev/blog/react-native-ota-update-size-bsdiff-patches/), with measured patch sizes.
