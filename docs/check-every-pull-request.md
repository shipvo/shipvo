# Check every pull request

The Shipvo check builds your app for web, runs it headless on Shipvo Phone, runs your `@shipvo/test` flows, explores the app, and posts one comment. The comment is edited on each push, not repeated.

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
- A failed or crashed test run, shown as a failure.
- Dead ends and buttons with no accessible name. These are notes.

The comment starts with the hidden marker `<!-- shipvo-check -->`. The next push finds it and edits it.

## Which screens are explored

`shipvo check --changed-from <base sha>` reads `git diff base...HEAD`. A screen under `app/` or `src/app/` counts as changed when its file changed or a file it imports (directly or through other files) changed. If no screen changed, nothing is explored and the comment says so. When any screen changed, `shipvo explore` walks the whole app, not only those screens; the comment lists the changed screens. Imports are followed by relative path only: tsconfig aliases such as `@/…` are not resolved, so a change reached only through an alias is reported as "not reached from any screen". Dynamic routes such as `/item/[id]` are listed as written; explore cannot open them literally. Use `fetch-depth: 0` on checkout so the base commit is available.

## When the check fails

Exit code 1 when a flow fails, a crash is found, `shipvo test` or `shipvo explore` crashes without a report, or no flows ran and the test command exited non-zero. Exploration notes never fail it.

With `--compare-base` the same flows also run on the base commit. Then only a flow that passed on base and fails on the pull request fails the check. A flow that already failed on base is shown as "still failing". If the base run itself fails, the comparison is skipped and the comment says so.

```bash
npx shipvo check --changed-from origin/main --compare-base
```

## Limits

Not yet: screenshots and a recording in the comment, and `shipvo explore --changed-from` to explore only changed screens. They are tracked in the follow-up on issue #550.

On a pull request from a fork the token is read-only, so the comment cannot be posted. The result is in the job log, the job summary and `shipvo-check/comment.md`.

The template uses `shipvo/shipvo/actions/check@main`, a moving ref, in a workflow that has `pull-requests: write`. Pin a release tag or a commit SHA once one exists.

The action runs `npx --no-install shipvo`, so add `@shipvo/cli` to your `devDependencies`.

`--compare-base` runs the base commit in a worktree that links the pull request's `node_modules`. If the pull request changed dependencies, the base run may use the wrong versions.

The simulator runs the web build in headless Chromium. See [parity-results](parity-results.md). 
