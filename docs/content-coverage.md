# Content coverage

One row per user-visible feature or advantage. Each column is a link, or empty when nothing exists yet. Docs, blog, tutorial and video agents pick the biggest gap in their column, newest and most important features first, and add their link here in the same commit. Source of features: `CHANGELOG.md`, `changes/`, `docs/ROADMAP.md` and merged PRs. First version, backfilled on 2026-11-05 from the docs, blog posts, tutorials and videos that exist; it is not yet complete.

## Priority now

Content agents take their next item from this list first (top to bottom, skipping cells already filled), then the rest of the table. The owner and the steward edit this list.

1. ~~Shipvo Testers and `shipvo store testers`~~ (done)
2. Shipvo Phone and `shipvo run` (Phone's own features and attach still open; blog; docs, video and `shipvo run` tutorial done)
3. Store path: `shipvo store` from working app to both stores (video, blog)
4. Your coding agent tests the app (agent simulator over MCP) (blog for founders)
5. Signed over-the-air updates, staged rollout and rollback (tutorial, video)
6. Record demo videos (`record_*`) (tutorial, video, blog; docs done)
7. The `shipvo` skill for coding agents (tutorial, blog; docs done)
8. Capacitor support (all columns, as slices land)

| Feature | Docs | Tutorial | Video | Blog |
| --- | --- | --- | --- | --- |
| Create an app and run it in the simulator | [getting-started](getting-started.md) | [first-app](tutorials/first-app.md) | [Create your first app](videos.md) | [build-a-mobile-app-without-coding](../blog/build-a-mobile-app-without-coding.md) |
| Shop template with your own products and prices | [getting-started](getting-started.md) | [your-own-shop](tutorials/your-own-shop.md) | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
| Signed over-the-air updates | [getting-started](getting-started.md) | | [Ship an update to phones](videos.md) | [who-signs-your-updates](../blog/who-signs-your-updates.md) |
| Small patches (bsdiff) | [spike-results](spike-results.md) | | | [react-native-ota-update-size-bsdiff-patches](../blog/react-native-ota-update-size-bsdiff-patches.md) |
| Staged rollout by cohort | [cli](cli.md) | | | [staged-rollouts](../blog/staged-rollouts.md) |
| Rollback and crash-loop protection | [cli](cli.md) | | | [roll-back-a-bad-react-native-update](../blog/roll-back-a-bad-react-native-update.md) |
| Agent simulator over MCP | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | [Have an AI assistant test your shop](videos.md) | [mcp-servers-for-mobile-app-testing](../blog/mcp-servers-for-mobile-app-testing.md) |
| Test your app with Claude, ChatGPT or Cursor | [test-with-an-assistant](test-with-an-assistant.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | [Have an AI assistant test your shop](videos.md) | [your-assistant-can-test-your-app](../blog/your-assistant-can-test-your-app.md) |
| Typed tests (`@shipvo/test`) and `export_test` | [testing](testing.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | [the-bug-our-first-typed-test-found](../blog/the-bug-our-first-typed-test-found.md) |
| `shipvo explore` (walk every button) | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | |
| Check every pull request (`shipvo ci init --check`) | [ci-check](ci-check.md) | | | |
| Measured simulator parity | [parity-results](parity-results.md) | | | |
| Simulated device features (camera, location, payment, biometrics, notifications) | [device-api](device-api.md) | | | [the-permission-you-never-test](../blog/the-permission-you-never-test.md) |
| Airplane-mode testing | [device-api](device-api.md) | | | [test-airplane-mode](../blog/test-airplane-mode.md) |
| Store path (`shipvo store`) | [store](store.md) | | | |
| Framework adapters and Capacitor | [adapters](adapters.md), [capacitor](capacitor.md) | | | |
| Self-hosting on Cloudflare | [self-hosting](self-hosting.md) | | | |
| Share a preview link (`shipvo preview`) | [getting-started](getting-started.md) | | | |
| Telemetry export to R2 | [telemetry-export](telemetry-export.md) | | | |
| Taking real orders: verify and settle | [taking-real-orders](taking-real-orders.md) | | | |
| Move from CodePush | [migrate-from-codepush](migrate-from-codepush.md) | | | [a-codepush-alternative-after-app-center](../blog/a-codepush-alternative-after-app-center.md) |
| New machine and key backup | [new-machine](new-machine.md) | | | |
| Release health dashboard and alerts | [self-hosting](self-hosting.md#revert-alerts-webhook), [telemetry-export](telemetry-export.md) | | | |
| Take mobile money payments | [device-api](device-api.md) | | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
| `shipvo test --repair`, `--report`, plain steps | [testing](testing.md) | | | |
| Release policy and `--dry-run-policy` | [CLI guide](cli.md) | | | |
| Audit log and `shipvo audit` | [CLI guide](cli.md) | | | |
| `shipvo auto-halt` | [CLI guide](cli.md), [self-hosting](self-hosting.md) | | | |
| MCP delivery results, `wait_for`, `settle` | [agents](agents.md), [mcp](../packages/mcp/README.md) | | | |
| `shipvo run android\|ios` (phone frame in your browser) | [run](run.md) | [run-your-app-on-a-phone](tutorials/run-your-app-on-a-phone.md) | [See your app on a phone in your browser](videos.md#see-your-app-on-a-phone-in-your-browser-with-shipvo-run) | |
| Assistant attaches to the live `shipvo run` phone (`open_app`) | [run](run.md), [agents](agents.md) | | | |
| Record demo videos (`record_start`, `record_marker`, `record_stop`) | [record](record.md), [worked example](record-a-demo-video.md) | | | |
| Shipvo Testers and `shipvo store testers` | [store](store.md), [get-your-12-testers](tutorials/get-your-12-testers.md) | [get-your-12-testers](tutorials/get-your-12-testers.md) | [Get your 12 Google Play testers](videos.md) | [google-play-12-testers-14-days](../blog/google-play-12-testers-14-days.md) |
| Real camera, microphone and location in the browser | [device-api](device-api.md) | | | |
| Gate a rollout on test results (`shipvo promote --report`, `--report-md`) | [testing](testing.md), [cli](cli.md) | | | |
| Test secrets (`secret(name)`, `{secret:NAME}`) | [testing](testing.md) | | | |
| The `shipvo` skill for coding agents | [agents](agents.md) | | | |
| Policy enforced by the control plane (weekday, staged rollout, max band) | [cli](cli.md) | | | |
| Hosted MCP `server/discover` support | [mcp](../packages/mcp/README.md) | | | |
| Phone Settings screen (`get_settings`, `set_setting`) | [phone-apps](phone-apps.md) | | | |
| Phone Browser app (`browser_*` tools) | [phone-apps](phone-apps.md) | | | |
| Phone home, recents, shade and power controls | [agents](agents.md), [phone-apps](phone-apps.md) | | | |
