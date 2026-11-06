# Launch kit: the Shipvo check on every pull request

Drafts for the owner to post. Every statement is from `docs/ci-check.md` and `changes/550-*.md`; no numbers are claimed.

Links: [docs](../../ci-check.md), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

Add `npx shipvo ci init --check` and every pull request gets one comment: which flows pass or fail, what `shipvo explore` found, and the screens your diff changed. It updates on each push. https://shipvo.dev/docs/ci-check/

## LinkedIn post

Your agent opens a pull request. Who checks the app?

Shipvo now does. Run one command in your app folder:

npx shipvo ci init --check

Commit the workflow it writes. From then on, each pull request gets a single comment. It shows pass or fail for each flow, what shipvo explore found by walking the buttons, and the screens your diff changed.

The comment updates on every push, so you never get a pile of them. Flows that passed on the base commit and fail now are listed first.

It runs on a plain GitHub Actions runner. No emulator, no device farm.

https://shipvo.dev/docs/ci-check/

## Show HN-style description

Shipvo is an open-source (Apache-2.0) React Native framework with a headless phone simulator. `npx shipvo ci init --check` writes a three-line GitHub workflow that builds your app for web, runs your flows, walks only the screens changed in the pull request with `shipvo explore --changed-from`, and posts one pull request comment with pass or fail per flow, findings and changed screens. It compares against the base commit and can fail on regressions. Docs: https://shipvo.dev/docs/ci-check/

## 30-second demo script (Video Studio)

1. 0-5 s: Terminal in an app folder. Type `npx shipvo ci init --check`. Output shows the workflow written.
2. 5-10 s: Commit and push a change to one screen; GitHub shows a pull request opening.
3. 10-20 s: The Actions run finishes. Open the pull request: the Shipvo check comment with flows, findings and changed screens.
4. 20-26 s: Push another commit. The same comment updates in place.
5. 26-30 s: Caption: "One comment per pull request. shipvo.dev/docs/ci-check".
