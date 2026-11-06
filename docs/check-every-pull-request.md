# Check every pull request

The Shipvo check builds your app for web, runs it headless on Shipvo Phone, runs your `@shipvo/test` flows, explores the screens the pull request changed, and posts one comment. The comment is edited on each push, not repeated.

## Set up

```bash
npm i -D @shipvo/cli @shipvo/test @shipvo/sim
npx shipvo ci init --check
git add .github/workflows/shipvo-check.yml && git commit -m "ci: Shipvo check"
```

Open a pull request. The workflow uses the composite action in `actions/check` of this repository. Everything runs in your own repository's Actions; nothing is sent to Shipvo.

## What the comment shows

- Pass or fail for each flow in `tests/*.steps`.
- Crashes and runtime errors found while exploring.
- Dead ends and buttons with no accessible name. These are notes.
- Screenshots (Android style and iPhone style) and a link to the recording, stored as workflow artifacts.

The comment starts with the hidden marker `<!-- shipvo-check -->`. The next push finds it and edits it.

## Which screens are explored

`shipvo check --changed-from <base sha>` reads `git diff base...HEAD`. A screen under `app/` or `src/app/` counts as changed when its file changed or a file it imports (directly or through other files) changed. If no screen changed, nothing is explored and the comment says so.

## When the check fails

Exit code 1 when a flow fails or a crash is found. Exploration notes never fail it.

With `--compare-base` the same flows also run on the base commit. Then only a flow that passed on base and fails on the pull request fails the check. A flow that already failed on base is shown as "still failing".

```bash
npx shipvo check --changed-from origin/main --compare-base
```

## Limits

The simulator runs the web build in headless Chromium. See [parity-results](parity-results.md). In this first version the comment links screenshots and the recording as artifacts of the run; GitHub does not render artifacts inline.
