# Check every pull request

Shipvo can build your app, run your flows and walk every button on each pull request. A failing flow or a crash fails the check. Exploration notes do not.

## Set up

```bash
npm i -D @shipvo/cli @shipvo/sim @shipvo/test
npx shipvo ci init --check
git add .github/workflows/shipvo-check.yml && git commit -m "ci: Shipvo check" && git push
```

That writes a workflow whose steps are three lines:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: shipvo/shipvo/actions/check@main
```

## What it does

1. Installs Node 22 and your dependencies.
2. Builds the app for web.
3. Runs `shipvo test` on `tests/*.steps`.
4. Runs `shipvo explore` and writes `explore-report.md` and `explore-report.json`.
5. Uploads the reports as the `shipvo-check` artifact.

The job fails when a flow fails or `shipvo explore` crashes. Findings from exploration are in the report only. A failing flow does not skip exploration, so you still get the report.

On pull requests the action runs `shipvo explore --changed-from <base sha>`, so the report covers only the screens your diff changed. Unchanged screens and dynamic screens (`[id]`, layouts) are not visited, and exploration does not follow links off a changed screen. Screens are picked the same way as for the comment and the screenshots. On other events the whole app is explored. If the diff touches no screen, the report is empty. Without `--changed-from`, `shipvo explore` works as before.

Run the same two commands locally with `npx shipvo ci check` while `npx shipvo sim --port 4545` is running.

Use `--force` to overwrite an existing workflow, and `--dry-run` to see it first.

## The pull request comment

On each pull request the check posts one comment and updates it on every push. It finds its own comment by a hidden marker, `<!-- shipvo-check -->`, so you never get a pile of them.

The comment shows:

- pass or fail for each flow;
- crashes or runtime errors, dead ends and other problems from `shipvo explore`;
- the screens your diff changed (up to four), picked from files under `app/` or `screens/` since the base commit (`--changed-from <sha>`).

Screenshots, when there are any, are uploaded in the `shipvo-check` artifact of your own workflow run. Open the run, scroll to Artifacts and download the zip. The action runs `npx shipvo ci shots --changed-from <sha>` before the comment. It opens each changed screen in the simulator (390x844) and saves one PNG per screen, up to four, in `shipvo-shots/`. Dynamic screens such as `[id]` and layouts are skipped. A screen that fails to capture is skipped and the check goes on. The comment is built and posted by your workflow with its `GITHUB_TOKEN`. Nothing is sent to Shipvo. The workflow needs `pull-requests: write` for the comment; without it the check still runs and the comment is skipped.

The workflow must check out the full history (`fetch-depth: 0`) so the diff against the base commit works. The generated workflow does this. On pull requests from forks the token is read-only, so the comment is skipped and the check prints a notice.

Run it by hand with `npx shipvo ci comment --changed-from <sha> --pr <number>`. Without a token it prints the comment.

### Compared with base

The action also builds the base commit in a second folder and runs the same flows there. The comment then has a "Compared with base" section: regressions first (flows that passed on base and fail now, with the first failing step), then fixed, then still failing. Flows only on the pull request are not regressions. The check fails on a regression because the action passes `--fail-on-regression`; by hand, use `npx shipvo ci comment --base-report base.json --report shipvo-report.json --fail-on-regression`. If the base report is missing or unreadable, the comment has no such section and the check does not fail. If the pull request report is missing, there is no comparison and no failure either. If the base commit cannot be checked out, the action prints a line saying so and skips the comparison.

A flaky flow can fail on the pull request and pass on base, and then the check fails. Re-run the job to see if the failure repeats. Flows that are new on the pull request and fail are listed under "New flows" but do not fail the check.

Not yet covered: recordings and running `shipvo explore` on the base.
