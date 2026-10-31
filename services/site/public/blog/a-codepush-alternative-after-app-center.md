# A CodePush alternative after App Center: what to move to, and what to check first

> Microsoft App Center shut down on March 31, 2025, and CodePush went with it. The options for over-the-air updates in React Native, what to check before you choose, and where Shipvo fits.

By Hans Ade, 2026-10-31. Canonical: https://shipvo.dev/blog/a-codepush-alternative-after-app-center/

If your React Native app still points at CodePush, the service it talks to is gone or going. Microsoft's App Center was, in Expo's words, "scheduled to shutter its services on March 31, 2025," and Microsoft is discontinuing CodePush with it. The question is what to move to.

## The mainstream answer: EAS Update

Expo's own write-up says that Microsoft's decision "leaves EAS Update as the most comparable alternative," and links a migration guide. If your app already uses Expo, or is willing to adopt `expo-updates`, this is the path with the most documentation and the most users. It is a hosted service with usage-based pricing; see our [pricing comparison](https://shipvo.dev/pricing/) for worked examples.

## What to check before you choose anything

Over-the-air updates run code on your users' phones, so the choice deserves a short checklist:

1. **Who can sign an update?** An update that is not cryptographically signed is only as safe as your server. Ask whether the client verifies a signature, and whose key it is. On EAS, code signing is available on the Production and Enterprise plans.
2. **What happens when an update crashes the app?** The worst case is a crash on every launch with no way to fetch the fix. Look for automatic rollback.
3. **Can you release to a few people first?** A staged rollout turns a bad update from an incident into a small annoyance. See [staged rollouts](https://shipvo.dev/blog/staged-rollouts/).
4. **Where does the service run, and can you leave?** Self-hosting is the exit if pricing or terms change. CodePush users have just learned why that matters.
5. **How big is the download?** On a slow connection, a full bundle can be the difference between an update that lands and one that does not.

## Where Shipvo fits

Shipvo is an open-source (Apache-2.0) alternative that is earlier in its life than EAS, and we say so. What it does today:

- **Signed updates.** The runtime verifies an Ed25519 signature before staging a bundle.
- **Small patches.** On our test phone, a Redmi 9A with 2 GB of RAM, a 64 KB patch replaced a 1.57 MB bundle. Cold start with the update was about 877 ms and applying it took roughly 240 to 302 ms. Full numbers are in [the spike results](https://github.com/shipvo/shipvo/blob/main/docs/spike-results.md).
- **Crash-loop revert.** After three failed boots the runtime goes back to the last good bundle.
- **Cohorts.** Release to 1%, then 10%, then everyone.
- **Self-hosting.** The control plane runs on Cloudflare Workers; see [self-hosting](https://github.com/shipvo/shipvo/blob/main/docs/self-hosting.md).

What it does not do yet: we have verified iOS over-the-air updates on the iOS Simulator in CI, but not yet on a physical iPhone. If you ship to iPhones today and need that proven, weigh it. Two tracking issues are open on [GitHub](https://github.com/shipvo/shipvo/issues).

## A migration in three steps

1. Pick the service from the checklist above and run it beside CodePush on a test build.
2. Ship one release to a small cohort and watch crash rates before widening.
3. Remove the CodePush SDK in the same release that switches the update URL, so no build has two update mechanisms.

For the comparison with Expo in detail, see [Shipvo vs Expo](https://shipvo.dev/compare/).

## Sources

- [How to replace App Center and CodePush](https://expo.dev/blog/how-to-replace-app-center-and-codepush), Expo
- [Microsoft is retiring App Center: here's what React Native developers should use instead](https://shift.infinite.red/microsoft-is-retiring-app-center-heres-what-react-native-developers-should-use-instead-c2a8786f971e), Infinite Red
