# Content coverage

One row per user-visible feature or advantage. Each column is a link, or empty when nothing exists yet. Docs, blog, tutorial and video agents pick the biggest gap in their column, newest and most important features first, and add their link here in the same commit. Source of features: `CHANGELOG.md`, `changes/`, `docs/ROADMAP.md` and merged PRs. Every row has a Docs link (checked 7 Nov). First version, backfilled on 2026-11-05 from the docs, blog posts, tutorials and videos that exist; it is not yet complete.

## Priority now

Content agents take their next item from this list first (top to bottom, skipping cells already filled), then the rest of the table. The owner and the steward edit this list.

1. Describe an app and it appears (`create_app`, `update_app`, `app_activity`; launch kit written 10 Nov; docs: [describe-an-app](describe-an-app.md); tutorial done 10 Nov; video needed; blog done 10 Nov) and the browser playground (launch kit written 10 Nov; tutorial, video and blog needed)
1b. Chess on Shipvo Phone: the live demo at shipvo.dev/demos/chess (two phones, Android and iOS, playing in the browser; #1168) and two coding agents playing a full game through MCP (#1166, when merged). Blog done (10 Nov), tutorial done; video now for the live page; the agent-vs-agent video and launch kit once #1166 merges. Docs: [demos/chess](demos/chess.md) (live page, `--agents`, `--record`, troubleshooting).
2. ~~Shipvo Testers and `shipvo store testers`~~ (done)
3. `shipvo lumi` (launch kit written 7 Nov; tutorial, video and blog done) and live reload in `shipvo run` (launch kit written 7 Nov; tutorial done 10 Nov; video needs the new section)
4. Shipvo Phone and `shipvo run` (launch kit written 6 Nov; Phone apps (Settings, Browser, Store, updates) need tutorial and video (blog done 10 Nov), and attach is still open; blog for `shipvo run` done; docs, video and `shipvo run` tutorial done)
5. Store path: `shipvo store` from working app to both stores (video done; tutorial, blog)
6. Your coding agent tests the app (agent simulator over MCP) (blog for founders)
7. Signed over-the-air updates, staged rollout and rollback (video; tutorial done)
8. Record demo videos (`record_*`) (tutorial, video, blog; docs done)
9. The `shipvo` skill for coding agents (tutorial, blog; docs done)
10. Check every pull request (`shipvo ci init --check`): launch kit written 6 Nov; tutorial, video and blog needed
11. Capacitor support (all columns, as slices land)

| Feature | Docs | Tutorial | Video | Blog |
| --- | --- | --- | --- | --- |
| Chess on Shipvo Phone: live demo and two agents playing through MCP (`--agents`, `--record`) | [demos/chess](demos/chess.md) | [chess-on-two-phones](tutorials/chess-on-two-phones.md) | | [two-ai-agents-play-chess-on-two-phones](../blog/two-ai-agents-play-chess-on-two-phones.md) |
| Browser playground (sample app on Android and iOS, device API, signed updates, many phones link) | [playground](playground.md) | | | |
| Describe an app and it appears (`create_app`, `update_app`, `app_activity`) | [describe-an-app](describe-an-app.md) | [describe-an-app](tutorials/describe-an-app.md) | | |
| Create an app and run it in the simulator | [getting-started](getting-started.md) | [first-app](tutorials/first-app.md) | [Create your first app](videos.md) | [build-a-mobile-app-without-coding](../blog/build-a-mobile-app-without-coding.md) |
| Shop template with your own products and prices | [getting-started](getting-started.md) | [your-own-shop](tutorials/your-own-shop.md) | | [mobile-money-is-the-checkout](../blog/mobile-money-is-the-checkout.md) |
| Signed over-the-air updates | [getting-started](getting-started.md), [new-machine](new-machine.md) | [ship-a-fix](tutorials/ship-a-fix.md) | [Ship an update to phones](videos.md) | [who-signs-your-updates](../blog/who-signs-your-updates.md) |
| Small patches (bsdiff) | [spike-results](spike-results.md) | | | [react-native-ota-update-size-bsdiff-patches](../blog/react-native-ota-update-size-bsdiff-patches.md) |
| Staged rollout by cohort | [cli](cli.md) | [ship-a-fix](tutorials/ship-a-fix.md) | | [staged-rollouts](../blog/staged-rollouts.md) |
| Rollback and crash-loop protection | [cli](cli.md) | [ship-a-fix](tutorials/ship-a-fix.md) | | [roll-back-a-bad-react-native-update](../blog/roll-back-a-bad-react-native-update.md) |
| Agent simulator over MCP | [agents](agents.md) | [test-with-an-assistant](tutorials/test-with-an-assistant.md) | [Have an AI assistant test your shop](videos.md), [S1 · E1 · From a chat to an app](videos.md#s1--e1--from-a-chat-to-an-app) | [mcp-servers-for-mobile-app-testing](../blog/mcp-servers-for-mobile-app-testing.md) |
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
| Live reload in `shipvo run` (save a file, the phone updates; plain error bar) | [run](run.md#edit-and-save-the-phone-updates) | [watch-your-app-update](tutorials/watch-your-app-update.md) | | |
| Assistant attaches to the live `shipvo run` phone (`open_app`, with `platform` and `show` to start the phone and watch) | [run](run.md), [agents](agents.md) | | | |
| Record demo videos (`record_start`, `record_marker`, `record_stop`) | [record](record.md), [worked example](record-a-demo-video.md) | | | |
| Shipvo Testers and `shipvo store testers` | [store](store.md), [get-your-12-testers](tutorials/get-your-12-testers.md) | [get-your-12-testers](tutorials/get-your-12-testers.md) | [Get your 12 Google Play testers](videos.md) | [google-play-12-testers-14-days](../blog/google-play-12-testers-14-days.md) |
| Private inbox per session for email-code and magic-link sign-in (`inbox_wait`, `inbox_read`, `phone.inbox`) | [email-sign-in](email-sign-in.md) | | | |
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
| Network profiles (`set_network_profile`, `get_network_profile`, `phone.setNetwork`, `phone.json` network) | [device-api](device-api.md#network-profiles), [phone-network](phone-network.md#over-mcp) | | | |
| Behaviour timeline (compare releases and pull requests) | [timeline](timeline.md) | | | |
| Run tests on a real emulator or simulator (`--device agent-device`) | [testing](testing.md#run-on-a-real-emulator-or-simulator-with-agent-device) | | | |
| Notes and Tasks first-party app | [phone-apps](phone-apps.md) | | | |
| Network off blocks the app's network calls (`TypeError: Network request failed`) | [device-api](device-api.md#network) | | | |
| Payment cancel returns `cancelled` (`@shipvo/device` 0.1.5) | [device-api](device-api.md#payments) | | | |
| Deep links: `open_url` and `Linking.openURL` switch to the owning app; one-shot initial URL | [phone-apps](phone-apps.md) | | | [test-links-that-leave-your-app](../blog/test-links-that-leave-your-app.md) |
| `shipvo agents setup` writes the MCP config for every coding agent (`--for`, `--all`, `--global`, `shipvo mcp`) | [cli](cli.md), [agents](agents.md) | | | |
| Spec blocks (chart, stat, progress, card, toggle, segmented, sheet navigation) | [spec-blocks](spec-blocks.md), [spec](../packages/spec/README.md) | | | |
| Pull-request screenshots before and after (`shipvo ci shots`) | [ci-check](ci-check.md) | | | |
| Lumi findings saved as tests (`shipvo explore --save-tests`) | [lumi](lumi.md) | | | |
| Self-host upgrade check, backup and restore | [self-hosting](self-hosting.md#back-up-and-upgrade) | | | |
| iOS apps on the UIScene lifecycle (`SceneDelegate`) | [cli](cli.md) | | | |
| Test your own build on the hosted phone (`upload_build`, `shipvo sim --hosted`, `app@build:<id>`) | [test-your-build](test-your-build.md) | | | |
| Score agents on app tasks (`shipvo eval run`, `shipvo eval report`) | [eval](eval.md) | | | |
| Rooms: phones in one room share one backend (`open_app room`, `list_sessions`) | [agents](agents.md#rooms-several-phones-one-backend) | | | |
| `shipvo agents setup --hosted` writes the hosted phone config | [cli](cli.md) | | | |
| Data sources that use a saved key (`auth.secret`, `secret_revoked`, `secret_domain`) | [spec-blocks](spec-blocks.md#data-sources-that-use-a-saved-key) | | | |
| `open_app` with `platform` and `show` opens the phone in your browser | [agents](agents.md), [run](run.md) | | | |
| Fuller shop template checkout (plain payment errors, offline message, Undo, confirmation screen) | [getting-started](getting-started.md#the-shop-checkout) | | | |
| Watch the agent's phone live (`/watch`) | [agents](agents.md#watch-the-agents-phone) | | | |
| Hosted MCP sign-in discovery (OAuth metadata, dynamic client registration) | [agents](agents.md) | | | |
| Kanban and timeline spec blocks (`App.move`) | [spec-blocks](spec-blocks.md#boards-and-timelines) | | | |
| Spec `vector` block and `motion` (fade, slide, scale, countUp, pulse) | [spec-blocks](spec-blocks.md#vector-drawings) | | | |
| Spec translations, locale formatting and right-to-left | [spec-blocks](spec-blocks.md#translations-and-right-to-left) | | | |
| First-party Calendar, Files and Photos, Wallet and Shop apps | [phone-apps](phone-apps.md#first-party-apps) | | | |
| Playground: device API and over-the-air update panels in the browser | [getting-started](getting-started.md#try-it-in-your-browser-first) | | | |
| `shipvo store policy` (privacy policy from what the app does) | [store](store.md) | | | |
| `shipvo sim` and `shipvo preview` open a Capacitor project | [capacitor](capacitor.md#see-it-in-the-simulator) | | | |
| Job handles for slow tools (`job_status`, `wait_ms` on `publish_preview` and `upload_build`) | [cli](cli.md), [agents](agents.md), [mcp](../packages/mcp/README.md) | | | |
| Saved-key routes: list, rotate, revoke and use log (`/vault/keys`, `/vault-ui/*` in the simulator) | [self-hosting](self-hosting.md#saved-key-routes-vault) | | | |
| Key rotation: `shipvo keys root`, `keys rotate sign` and `upload` | [key-rotation](key-rotation.md) | | | |
| Per-app device permissions on the install card (`set_app_permission`) | [phone-apps](phone-apps.md#device-permissions-per-app) | | | |
| Key rotations in the pointer response (`rotations`) | [self-hosting](self-hosting.md#pointer-response-and-key-rotations) | | | |
| Playground Many phones (1 to 12 Android and iOS phones, shareable link) | [getting-started](getting-started.md#try-it-in-your-browser-first) | | | |
| Pin and hide apps on the home screen (`pin_app`, `hide_app`) | [phone-apps](phone-apps.md) | | | [test-an-app-on-a-phone-with-a-store-and-other-apps](../blog/test-an-app-on-a-phone-with-a-store-and-other-apps.md) |
| Arrange the home screen (`arrange_apps`, schedules, `set_phone_time`) | [phone-apps](phone-apps.md) | | | [test-an-app-on-a-phone-with-a-store-and-other-apps](../blog/test-an-app-on-a-phone-with-a-store-and-other-apps.md) |
| Describe an app and it appears (`create_app`, `update_app`) | [describe-an-app](describe-an-app.md), [phone-apps](phone-apps.md) | | | [describe-an-app-and-it-appears-on-a-phone](../blog/describe-an-app-and-it-appears-on-a-phone.md) |
| Export and import a phone's apps and home-screen layout (`export_phone_apps`, `import_phone_apps`, layout warnings) | [phone-apps](phone-apps.md) | | | |
| Real app install from the Store (`install_app`, `find_apps`) | [phone-apps](phone-apps.md) | | | |
| SAML sign-in for the control plane | [sso](sso.md) | | | |
| W3C `traceparent` recorded from MCP tool calls | [mcp](../packages/mcp/README.md) | | | |
| Spec `calendar` and `map` blocks (month, week, agenda; pins with no tile calls) | [spec-blocks](spec-blocks.md#calendars-and-maps) | | | |
| Open a hosted build from a link (`POST /session` with `build_url`) | [test-your-build](test-your-build.md#open-a-build-from-a-link) | | | |
| Secrets screen in the phone's Settings (saved keys, metadata only, Rotate, Revoke and Use log buttons) | [phone-apps](phone-apps.md#see-saved-keys-in-settings) | | | |
| Arrange the home screen and set the phone's clock (`arrange_apps`, `set_phone_time`, `placement` in `phone.json`) | [phone-apps](phone-apps.md#arrange-the-home-screen) | | | |
| Phone frame page `/phone?session=` with Store and installed apps | [phone-apps](phone-apps.md) | | | |
| Watch link on the hosted phone (`watch_url`, read-only, sign in to take over) | [agents](agents.md#watch-link-on-the-hosted-phone) | | | |
| Hosted MCP sign-in with URL client ids (Client ID Metadata Documents) | [agents](agents.md) | | | |
| Data sources refresh on an interval (`refresh`, 30 seconds or more) | [spec-blocks](spec-blocks.md#keep-a-data-source-fresh) | | | |
| Gallery of example specs (`packages/spec/gallery`: habit tracker, workout log, expense splitter, trip checklist, flashcards, reading board, meal planner, favourite places) | [spec-blocks](spec-blocks.md#example-specs) | | | |
| Faster rebuild after a save in `shipvo run` (Metro cache kept) | [run](run.md) | | | |
| Signing seed backup and restore on a new machine (`shipvo keys export`, `shipvo keys import`) | [new-machine](new-machine.md) | | | |
| See what an agent built and changed in a spec app (`app_activity`) | [phone-apps](phone-apps.md#see-what-was-built-and-changed) | | | |
| Fetch an app's live data now (`refresh_app`) | [phone-apps](phone-apps.md#fetch-live-data-now) | | | |
| Show or hide an app on a time window (`schedule_app`, `clear_schedule`) | [phone-apps](phone-apps.md#arrange-the-home-screen) | | | |
| Network proxy refusal codes (`x-shipvo-net-error`) | [phone-network](phone-network.md#troubleshooting) | | | |
| Room log and notes (`room_log`, `room_note`): a lead agent sees what the others did | [agents](agents.md#room-log-and-notes) | | | |
| Shop template warns when a price is in the wrong unit (`[shop]` message, failing test) | [your-own-shop](tutorials/your-own-shop.md#troubleshooting), [getting-started](getting-started.md#the-shop-checkout) | [your-own-shop](tutorials/your-own-shop.md) | | |
| Android patch falls back to the full download on out-of-memory or over the memory budget (`patchError`) | [getting-started](getting-started.md) | | | |
| Prefixed element refs after a restart (`f1e2`, `p1e5`; `stale_ref`) | [agents](agents.md) | | | |
| Spec `csv()` function to export a collection | [phone-apps](phone-apps.md), [app-spec](design/app-spec.md) | | | |
| Roll back safely with a state version (`stateVersion`, `--allow-state-downgrade`) | [rollbacks-and-stored-data](rollbacks-and-stored-data.md) | | | |
| Session inbox for emailed codes and magic links (`inbox_wait`, `inbox_read`, `inbox_clear`, `phone.inbox`) | [email-sign-in](email-sign-in.md), [agents](agents.md) | | | |
| Assistant Inbox (`send_message`, `check_inbox`, `hand_off`, `{{ caller }}`) | [phone-apps](phone-apps.md#assistants-talking-to-each-other) | | | |
| Patch falls back to full download on small heaps (Android, `patchError`) | [runtime](../packages/runtime/README.md#patches-on-small-heaps-android) | | | |
| Permissions detected from camera, scanner and file blocks | [phone-apps](phone-apps.md#device-permissions-per-app) | | | |
