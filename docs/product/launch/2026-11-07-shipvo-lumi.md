# Launch kit: `shipvo lumi` (test your app while you watch)

Drafts for the owner to post. Every statement is from `docs/lumi.md`, `changes/1021-lumi-flow-names.md` and `changes/1019-lumi-dedupe.md`; no numbers are claimed.

Links: [docs](../../lumi.md), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

One command tests your app while you watch: `npx shipvo lumi`. Your app opens on an Android or iOS phone in your browser, Lumi taps through it, captions each step and lists what broke, with a Replay button. No AI account needed. https://shipvo.dev/docs/lumi/

## LinkedIn post

You made an app. Does every button work?

`npx shipvo lumi` builds a web copy of your app and opens it on a phone in your browser, Android or iOS. Type "test my app" and Lumi, a small glowing orb beside the camera, taps through it.

- A caption names each step, such as "Tapping Checkout".
- Each problem is a finding: a button that does nothing, a screen that stays blank.
- Press Replay to watch a finding happen again.
- Everyday names work: "test checkout" finds Cart then Pay, and says which path it picked.

It runs on your computer and needs no AI account.

Try it in your app folder: `npx shipvo lumi`

https://shipvo.dev/docs/lumi/

## Show HN-style description

`shipvo lumi` opens your app on Shipvo Phone (Android or iOS skin) in the browser with a sidebar that has a live feed, findings with Replay, coverage and a plain-text command box (`test my app`, `test <flow>`, `try <flow> with bad input`, `replay bug <n>`). It uses the same walker as `shipvo explore`, with `--max-steps`, `--max-depth` and `--seed` so a run repeats. It runs locally and needs no AI account. Docs: https://shipvo.dev/docs/lumi/

## 30-second demo script (Video Studio)

1. 0-5 s: Terminal: `npx shipvo lumi` in the Tide and Tackle folder; the browser opens with the phone and the Lumi sidebar.
2. 5-12 s: Type `test checkout`. The caption reads "Tapping Checkout"; the sidebar lists each action.
3. 12-20 s: A finding appears. Press Replay and watch it again.
4. 20-26 s: Run `npx shipvo lumi ios`; the same app on the iOS phone.
5. 26-30 s: Caption: "shipvo lumi. shipvo.dev/docs/lumi".
