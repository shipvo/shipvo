# Launch kit: save a file, the phone reloads (`shipvo run`)

Drafts for the owner to post. Every statement is from `docs/run.md` and `changes/983-run-live-reload.md`; no numbers are claimed. The test `packages/cli/test/run-live-reload.test.ts` prints the save-to-visible time for the Android and iOS frames; quote those numbers only with a link to a CI run.

Links: [docs](../../run.md), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

`shipvo run android` and `shipvo run ios` now reload on save. Edit a file, and the app in the phone in your browser rebuilds and reloads on the same screen. A typo keeps your last good version and shows the error in the terminal and under the phone. https://shipvo.dev/docs/run/

## LinkedIn post

Edit, save, see it.

`shipvo run android` and `shipvo run ios` show your app on a phone in your browser. They now watch your project too.

- Save a file and the web copy rebuilds in the background.
- The phone reloads and stays on the same screen.
- The terminal prints one line per rebuild.
- If you make a typo, the phone keeps your last good version. The error shows in the terminal and in a red bar under the phone. Save the fix and the bar goes away.

Your AI agent edits files; you watch the phone change.

https://shipvo.dev/docs/run/

## Show HN-style description

`shipvo run android|ios` serves your Expo web build inside an Android or iOS phone frame. It now rebuilds on file save and reloads the app in the frame on the same screen address. A failed rebuild keeps the last good page and shows the error in the terminal and in a bar outside the phone. Tests edit a fixture app and check both frames in Chromium (`packages/cli/test/run-live-reload.test.ts`). Docs: https://shipvo.dev/docs/run/

## 30-second demo script (Video Studio)

1. 0-6 s: `npx shipvo run android` and `npx shipvo run ios`; both phones open.
2. 6-14 s: Edit the shop title in the editor and save; the terminal prints `rebuilt in ...`, the phone updates on the same screen.
3. 14-22 s: Add a typo and save. The red bar appears under the phone; the app stays as it was.
4. 22-27 s: Fix the typo and save; the bar goes away and the phone reloads.
5. 27-30 s: Caption: "Save a file. The phone reloads. shipvo.dev/docs/run".
