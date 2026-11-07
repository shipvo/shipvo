# Content coverage

One row per user-visible feature or advantage. Each column is a link, or empty when nothing exists yet. Docs, blog, tutorial and video agents pick the biggest gap in their column, newest and most important features first, and add their link here in the same commit. Source of features: `CHANGELOG.md`, `changes/`, `docs/ROADMAP.md` and merged PRs. Every row has a Docs link (checked 7 Nov). First version, backfilled on 2026-11-05 from the docs, blog posts, tutorials and videos that exist; it is not yet complete.

## Priority now

Content agents take their next item from this list first (top to bottom, skipping cells already filled), then the rest of the table. The owner and the steward edit this list.

1. Chess on Shipvo Phone: the live demo at shipvo.dev/demos/chess (two phones, Android and iOS, playing in the browser; #1168) and two coding agents playing a full game through MCP (#1166, when merged). Blog, tutorial and video now for the live page; the agent-vs-agent video and launch kit once #1166 merges. Docs: [demos/chess](demos/chess.md) (live page, `--agents`, `--record`, troubleshooting).
2. ~~Shipvo Testers and `shipvo store testers`~~ (done)
3. `shipvo lumi` (launch kit written 7 Nov; tutorial, video and blog done) and live reload in `shipvo run` (launch kit written 7 Nov; tutorial and video need the new section)
4. Shipvo Phone and `shipvo run` (launch kit written 6 Nov; Phone apps (Settings, Browser, Store, updates) need tutorial, video and blog, and attach is still open; blog for `shipvo run` done; docs, video and `shipvo run` tutorial done)
5. Store path: `shipvo store` from working app to both stores (video done; tutorial, blog)
6. Your coding agent tests the app (agent simulator over MCP) (blog for founders)
7. Signed over-the-air updates, staged rollout and rollback (video; tutorial done)
8. Record demo videos (`record_*`) (tutorial, video, blog; docs done)
9. The `shipvo` skill for coding agents (tutorial, blog; docs done)
10. Check every pull request (`shipvo ci init --check`): launch kit written 6 Nov; tutorial, video and blog needed
11. Capacitor support (all columns, as slices land)

| Feature | Docs | Tutorial | Video | Blog |
| --- | --- | --- | --- | --- |
| Chess on Shipvo Phone: live demo and two agents playing through MCP (`--agents`, `--record`) | [demos/chess](demos/chess.md) | [chess-on-two-phones](tutorials/chess-on-two-phones.md) | | |
| Create an app and run it in the simulator | [getting-started](getting-started.md) | [first-app](tutorials/first-app.md) | [Create your first app](videos.md) | [build-a-mobile-app-without-coding](../blog/build-a-mobile-app-without-coding.md) |
| Shop template with your own products and prices | [getting-started](getting-started.md) | [your-own-shop](tutorials/your-own-shop.md) | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
| Signed over-the-air updates | [getting-started](getting-started.md) | [ship-a-fix](tutorials/ship-a-fix.md) | [Ship an update to phones](videos.md) | [who-signs-your-updates](../blog/who-signs-your-updates.md) |
| Small patches (bsdiff) | [spike-results](spike-results.md) | | | [react-native-ota-update-size-bsdiff-patches](../blog/react-native-ota-update-size-bsdiff-patches.md) |
| Staged rollout by cohort | [cli](cli.md) | [ship-a-fix](tutorials/ship-a-fix.md) | | [staged-rollouts](../blog/staged-rollouts.md) |
| Rollback and crash-loop protection | [cli](cli.md) | [ship-a-fix](tutorials/ship-a-fix.md) | | [roll-back-a-bad-react-native-update](../blog/roll-back-a-bad-react-native-update.md) |
| Agent simulator over MCP | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | [Have an AI assistant test your shop](videos.md) | [mcp-servers-for-mobile-app-testing](../blog/mcp-servers-for-mobile-app-testing.md) |
| Test your app with Claude, ChatGPT or Cursor | [test-with-an-assistant](test-with-an-assistant.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | [Have an AI assistant test your shop](videos.md) | [your-assistant-can-test-your-app](../blog/your-assistant-can-test-your-app.md) |
| Typed tests (`@shipvo/test`) and `export_test` | [testing](testing.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | [the-bug-our-first-typed-test-found](../blog/the-bug-our-first-typed-test-found.md) |
| `shipvo explore` (walk every button) | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | | |
| Check every pull request (`shipvo ci init --check`) | [ci-check](ci-check.md) | | | |
| Measured simulator parity | [parity-results](parity-results.md) | | | |
| Simulated device features (camera, location, payment, biometrics, notifications) | [device-api](device-api.md) | | | [the-permission-you-never-test](../blog/the-permission-you-never-test.md) |
| Airplane-mode testing | [device-api](device-api.md) | | | [test-airplane-mode](../blog/test-airplane-mode.md) |
| Store path (`shipvo store`) | [store](store.md) | | [From working app to Google Play and the App Store](videos.md#from-working-app-to-google-play-and-the-app-store) | |
| Framework adapters and Capacitor | [adapters](adapters.md), [capacitor](capacitor.md) | | | |
| Self-hosting on Cloudflare | [self-hosting](self-hosting.md) | | | |
| Share a preview link (`shipvo preview`) | [getting-started](getting-started.md) | | | |
| Telemetry export to R2 | [telemetry-export](telemetry-export.md) | | | |
| Move from CodePush | [migrate-from-codepush](migrate-from-codepush.md) | | | [a-codepush-alternative-after-app-center](../blog/a-codepush-alternative-after-app-center.md) |
| New machine and key backup | [new-machine](new-machine.md) | | | |
| Release health dashboard and alerts | [self-hosting](self-hosting.md#revert-alerts-webhook), [telemetry-export](telemetry-export.md) | | | |
| Take mobile money payments | [device-api](device-api.md) | | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
| `shipvo test --repair`, `--report`, plain steps | [testing](testing.md) | | | |
| Release policy and `--dry-run-policy` | [CLI guide](cli.md) | | | |
| Audit log and `shipvo audit` | [CLI guide](cli.md) | | | |
| `shipvo auto-halt` | [CLI guide](cli.md), [self-hosting](self-hosting.md) | [ship-a-fix](tutorials/ship-a-fix.md) | | |
| MCP delivery results, `wait_for`, `settle` | [agents](agents.md), [mcp](../packages/mcp/README.md) | | | |
| `shipvo run android\|ios` (phone frame in your browser) | [run](run.md) | [run-your-app-on-a-phone](tutorials/run-your-app-on-a-phone.md) | [See your app on a phone in your browser](videos.md#see-your-app-on-a-phone-in-your-browser-with-shipvo-run) | [see-your-react-native-app-on-a-phone-in-your-browser](../blog/see-your-react-native-app-on-a-phone-in-your-browser.md) |
| Assistant attaches to the live `shipvo run` phone (`open_app`, with `platform` and `show` to start the phone and watch) | [run](run.md), [agents](agents.md) | | | |
| Record demo videos (`record_start`, `record_marker`, `record_stop`) | [record](record.md), [worked example](record-a-demo-video.md) | | | |
| Shipvo Testers and `shipvo store testers` | [store](store.md), [get-your-12-testers](tutorials/get-your-12-testers.md) | [get-your-12-testers](tutorials/get-your-12-testers.md) | [Get your 12 Google Play testers](videos.md) | [google-play-12-testers-14-days](../blog/google-play-12-testers-14-days.md) |
| Real camera, microphone and location in the browser | [device-api](device-api.md) | | | |
| Gate a rollout on test results (`shipvo promote --report`, `--report-md`) | [testing](testing.md), [cli](cli.md) | | | |
| Test secrets (`secret(name)`, `{secret:NAME}`) | [testing](testing.md) | | | |
| The `shipvo` skill for coding agents | [agents](agents.md) | | | |
| Policy enforced by the control plane (weekday, staged rollout, max band) | [cli](cli.md) | | | |
| Hosted MCP `server/discover` support | [mcp](../packages/mcp/README.md) | | | |
| Phone Settings screen (`get_settings`, `set_setting`) | [phone-apps](phone-apps.md) | | | [test-dark-mode-large-text-and-rtl-in-react-native](../blog/test-dark-mode-large-text-and-rtl-in-react-native.md) |
| Phone Browser app (`browser_*` tools) | [phone-apps](phone-apps.md) | | | [test-links-that-leave-your-app](../blog/test-links-that-leave-your-app.md) |
| Phone home, recents, shade and power controls | [agents](agents.md), [phone-apps](phone-apps.md) | | | |
| Lumi on Shipvo Phone (captions, reactions, first-run guide) | [lumi](lumi.md) | [test-your-app-with-lumi](tutorials/test-your-app-with-lumi.md) | | [lumi-tests-your-app-while-you-watch](../blog/lumi-tests-your-app-while-you-watch.md) |
| `shipvo lumi` (test your app while you watch) | [lumi](lumi.md), [cli](cli.md) | [test-your-app-with-lumi](tutorials/test-your-app-with-lumi.md) | [Have Lumi test your app while you watch](videos.md#have-lumi-test-your-app-while-you-watch) | [lumi-tests-your-app-while-you-watch](../blog/lumi-tests-your-app-while-you-watch.md) |
| Network profiles (`set_network_profile`, `device.net.type`) | [device-api](device-api.md#network) | | | |
| Behaviour timeline (compare releases and pull requests) | [timeline](timeline.md) | | | |
| Run tests on a real emulator or simulator (`--device agent-device`) | [testing](testing.md#run-on-a-real-emulator-or-simulator-with-agent-device) | | | |
| Network off blocks the app's network calls (`TypeError: Network request failed`) | [device-api](device-api.md#network) | | | |
| Payment cancel returns `cancelled` (`@shipvo/device` 0.1.5) | [device-api](device-api.md#payments) | | | |
| Deep links: `open_url` and `Linking.openURL` switch to the owning app; one-shot initial URL | [phone-apps](phone-apps.md) | | | [test-links-that-leave-your-app](../blog/test-links-that-leave-your-app.md) |
| `shipvo agents setup` writes the MCP config for every coding agent (`--for`, `--all`, `--global`, `shipvo mcp`) | [cli](cli.md), [agents](agents.md) | | | |
| Spec blocks (chart, stat, progress, card, toggle, segmented, sheet navigation) | [spec-blocks](spec-blocks.md), [spec](../packages/spec/README.md) | | | |
| Notes and Tasks first-party app | [phone-apps](phone-apps.md) | | | |
| Pull-request screenshots before and after (`shipvo ci shots`) | [ci-check](ci-check.md) | | | |
| Lumi findings saved as tests (`shipvo explore --save-tests`) | [lumi](lumi.md) | | | |
| Self-host upgrade check, backup and restore | [self-hosting](self-hosting.md#back-up-and-upgrade) | | | |
| iOS apps on the UIScene lifecycle (`SceneDelegate`) | [cli](cli.md) | | | |
| Test your own build on the hosted phone (`upload_build`, `shipvo sim --hosted`, `app@build:<id>`) | [test-your-build](test-your-build.md) | | | |
