# Launch kit: Shipvo Phone and `shipvo run`

Drafts for the owner to post. Check each claim against the linked docs before posting.

**Links:** [docs: run](../../run.md), [docs: record](../../record.md), [parity results](../../parity-results.md), PRs #454, #507, #510, #525. Features page: https://shipvo.dev/features/ . Image: `services/site/public/img/run-phones.png`.

## X post (under 280 characters)

`npx shipvo run android` puts your app on a simulated Android phone in your browser. `ios` gives an iPhone-style one. No emulator, no Xcode, no Playwright. Your AI assistant can drive the same phone while you watch. https://shipvo.dev/docs/run/

## LinkedIn post

Seeing your app on a phone usually means installing Android Studio or Xcode first.

With Shipvo, open a terminal in your app folder and type `npx shipvo run android`. Shipvo builds a web copy of your app and opens a phone-shaped frame in your browser. Use `ios` for an iPhone-style frame. A label on the phone says "Simulated", because it is a copy and not a real device.

Then your AI assistant can call `open_app` and drive the same phone: tap, type, scroll and go back, while you watch. When you want a demo, it can record an MP4 of the phone with chapter markers.

How close is the simulation to a real phone? We publish it: https://shipvo.dev/docs/parity-results/

Run guide: https://shipvo.dev/docs/run/

## Show HN-style description

`shipvo run android|ios` builds your Expo app for web with a simulated device and opens it in a phone frame (Android 412x915 with a punch-hole camera, iPhone-style 393x852 with an island cutout) in your own browser, with no emulator and no Playwright. While it runs it writes `.shipvo/run.json`, and the Shipvo MCP tool `open_app` attaches to that live phone so a coding agent can tap, type, scroll and go back while you watch (the agent sees the accessibility tree with refs). `record_start`, `record_marker` and `record_stop` write an MP4 of the frame (needs ffmpeg). The frames are our own artwork. Apache-2.0. Run guide: https://shipvo.dev/docs/run/ . Simulator parity against the Android emulator and iOS Simulator, with the gaps listed: https://shipvo.dev/docs/parity-results/

## 30-second demo script (for the Video Studio)

1. (0-4 s) Terminal in a `shipvo init` app. Type `npx shipvo run android`. Voice: "One command."
2. (4-10 s) Browser opens on the Android frame with the Tide & Tackle sample app. Voice: "Your app, on a simulated phone, in your browser."
3. (10-14 s) Stop, run `npx shipvo run ios`. The iPhone-style frame opens.
4. (14-24 s) Split screen: assistant chat on the left, phone on the right. The assistant calls `open_app` and taps through to the cart. The phone moves.
5. (24-28 s) The assistant calls `record_stop`; the MP4 path appears.
6. (28-30 s) End card: shipvo.dev/docs/run
