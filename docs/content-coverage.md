# Content coverage

One row per user-visible feature or advantage. Each column is a link, or empty when nothing exists yet. Docs, blog, tutorial and video agents pick the biggest gap in their column, newest and most important features first, and add their link here in the same commit. Source of features: `CHANGELOG.md`, `changes/`, `docs/ROADMAP.md` and merged PRs. First version, backfilled on 2026-11-05 from the docs, blog posts, tutorials and videos that exist; it is not yet complete.

| Feature | Docs | Tutorial | Video | Blog |
| --- | --- | --- | --- | --- |
| Create an app and run it in the simulator | [getting-started](getting-started.md) | [first-app](tutorials/first-app.md) | [Create your first app](videos.md) | [build-a-mobile-app-without-coding](../blog/build-a-mobile-app-without-coding.md) |
| Shop template with your own products and prices | [getting-started](getting-started.md) | [your-own-shop](tutorials/your-own-shop.md) | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
| Signed over-the-air updates | [getting-started](getting-started.md) | | [Ship an update to phones](videos.md) | [who-signs-your-updates](../blog/who-signs-your-updates.md) |
| Small patches (bsdiff) | [spike-results](spike-results.md) | | | [react-native-ota-update-size-bsdiff-patches](../blog/react-native-ota-update-size-bsdiff-patches.md) |
| Staged rollout by cohort | [cli](cli.md) | | | [staged-rollouts](../blog/staged-rollouts.md) |
| Rollback and crash-loop protection | [cli](cli.md) | | | [roll-back-a-bad-react-native-update](../blog/roll-back-a-bad-react-native-update.md) |
| Agent simulator over MCP | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | [mcp-servers-for-mobile-app-testing](../blog/mcp-servers-for-mobile-app-testing.md) |
| Test your app with Claude, ChatGPT or Cursor | [test-with-an-assistant](test-with-an-assistant.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | [your-assistant-can-test-your-app](../blog/your-assistant-can-test-your-app.md) |
| Typed tests (`@shipvo/test`) and `export_test` | [testing](testing.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | [the-bug-our-first-typed-test-found](../blog/the-bug-our-first-typed-test-found.md) |
| `shipvo explore` (walk every button) | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | |
| Measured simulator parity | [parity-results](parity-results.md) | | | |
| Simulated device features (camera, location, payment, biometrics, notifications) | [device-api](device-api.md) | | | [the-permission-you-never-test](../blog/the-permission-you-never-test.md) |
| Airplane-mode testing | [device-api](device-api.md) | | | [test-airplane-mode](../blog/test-airplane-mode.md) |
| Store path (`shipvo store`) | [store](store.md) | | | |
| Framework adapters and Capacitor | [adapters](adapters.md), [capacitor](capacitor.md) | | | |
| Self-hosting on Cloudflare | [self-hosting](self-hosting.md) | | | |
| Share a preview link (`shipvo preview`) | [getting-started](getting-started.md) | | | |
| Telemetry export to R2 | [telemetry-export](telemetry-export.md) | | | |
| Move from CodePush | [migrate-from-codepush](migrate-from-codepush.md) | | | [a-codepush-alternative-after-app-center](../blog/a-codepush-alternative-after-app-center.md) |
| New machine and key backup | [new-machine](new-machine.md) | | | |
| Release health dashboard and alerts | | | | |
| Take mobile money payments | [device-api](device-api.md) | | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
