# Check every pull request

This page is for anyone who owns a Shipvo app's GitHub repository. In about two minutes you add one workflow file. After that, every pull request gets a check that builds your app, runs your flows and walks every button, then posts one comment with the result. A failing flow or a crash fails the check. Exploration notes do not.

You need: an app made with `shipvo init` (or adopted with it), flows in `tests/*.steps`, and a GitHub repository.

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
4. On a pull request, runs `shipvo explore --changed-from <base sha>`. It walks only the screens whose files changed (up to four, from `app/` or `screens/`). Each one is opened as a deep link, `<scheme>://<screen>`, with the scheme from `expo.scheme` in `app.json`; your app needs an `onUrl` listener. The changed screens replace the `routes` in `shipvo.json` for this run. If no screen changed, it walks nothing and says so in the log and the report. The checkout needs `fetch-depth: 0` to read the diff. Without it, or without a scheme, a message is printed and the whole app is walked, using `routes` as usual. Writes `explore-report.md` and `explore-report.json`.
5. Uploads the reports as the `shipvo-check` artifact.

The job fails when a flow fails or `shipvo explore` crashes. Findings from exploration are in the report only. A failing flow does not skip exploration, so you still get the report.

Run the same two commands locally with `npx shipvo ci check` (add `--changed-from <sha>` to limit exploration to changed screens) while `npx shipvo sim --port 4545` is running.

Use `--force` to overwrite an existing workflow, and `--dry-run` to see it first.

## The pull request comment

On each pull request the check posts one comment and updates it on every push. It finds its own comment by a hidden marker, `<!-- shipvo-check -->`, so you never get a pile of them.

The comment shows:

- pass or fail for each flow;
- crashes or runtime errors, dead ends and other problems from `shipvo explore`;
- the screens your diff changed (up to four), picked from files under `app/` or `screens/` since the base commit (`--changed-from <sha>`).

Screenshots, when there are any, are uploaded in the `shipvo-check` artifact of your own workflow run. Open the run, scroll to Artifacts and download the zip. The action runs `npx shipvo ci shots --changed-from <sha>` on the PR head and again on the base commit. It opens each changed screen on Android and iOS (`--skins android,ios`, 390x844, light theme) and saves `<dir>/<skin>/<screen>.png`, up to four screens, in `shipvo-shots-after/` and `shipvo-shots-before/`. The comment shows up to six before and after pairs; a screen the base commit does not have shows as after only. Dynamic screens such as `[id]` and layouts are skipped. A screen that fails to capture is skipped and the check goes on. The comment is built and posted by your workflow with its `GITHUB_TOKEN`. Nothing is sent to Shipvo. The workflow needs `pull-requests: write` for the comment; without it the check still runs and the comment is skipped.

The workflow must check out the full history (`fetch-depth: 0`) so the diff against the base commit works. The generated workflow does this. On pull requests from forks the token is read-only, so the comment is skipped and the check prints a notice.

Run it by hand with `npx shipvo ci comment --changed-from <sha> --pr <number>`. Without a token it prints the comment.

### Compared with base

The action also builds the base commit in a second folder and runs the same flows there. The comment then has a "Compared with base" section: regressions first (flows that passed on base and fail now, with the first failing step), then fixed, then still failing. Flows only on the pull request are not regressions. The check fails on a regression because the action passes `--fail-on-regression`; by hand, use `npx shipvo ci comment --base-report base.json --report shipvo-report.json --fail-on-regression`. If the base report is missing or unreadable, the comment has no such section and the check does not fail. If the pull request report is missing, there is no comparison and no failure either. If the base commit cannot be checked out, the action prints a line saying so and skips the comparison.

A flaky flow can fail on the pull request and pass on base, and then the check fails. Re-run the job to see if the failure repeats. Flows that are new on the pull request and fail are listed under "New flows" but do not fail the check.


### Before and after screens

With `--before-shots <dir> --after-shots <dir>` (each laid out as `<dir>/android/<screen>.png` and `<dir>/ios/<screen>.png`), the comment has a "Before and after" section. Each screen gets a table with an Android row and an iOS row, and a Before and an After column. Changed screens come first; up to six are shown and the rest are counted.

On a public repository the workflow's token uploads the images to the `shipvo-media` branch of your own repository, so the workflow needs `contents: write`. The comment shows the images inline. Each push uploads its own copies, and the comment is updated in place. A file that is already there counts as uploaded only when it holds the same bytes.

On a private repository, or when the repository cannot be read, nothing is uploaded. The comment lists the file names for each screen and skin, and the images are in the folders you passed to `--before-shots` and `--after-shots`. Upload those folders as an artifact in your workflow to keep them.

## Send a fix to the first band

When a merged pull request fixes a failing flow, `npx shipvo ci fix` runs `shipvo test`. If every flow passes, it publishes to the first band (`b0`, 1% of users) and updates the check comment with the release id. If a flow fails, it publishes nothing and the comment names the flow. It checks `policy` in `shipvo.json` first, and it only ever publishes to `b0`, so it never goes above `maxBand`. Widening stays with release health and the release policy.

Add a workflow. It needs the same secrets as `shipvo publish` and a label named `fixes-flow` on the pull request:

```yaml
name: Shipvo fix to first band
on:
  pull_request:
    types: [closed]
permissions:
  contents: read
  pull-requests: write
jobs:
  fix:
    if: github.event.pull_request.merged == true && contains(github.event.pull_request.labels.*.name, 'fixes-flow')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx shipvo ci fix
        env:
          SHIPVO_PR: ${{ github.event.pull_request.number }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # add the publish secrets your app uses
```

The comment gets a "Fix release" section: `Published release N to the first band`, or `Nothing was published` and the failing flow names. The step exits 1 when it publishes nothing.

## Troubleshooting

| What you see | Why | What to do |
| --- | --- | --- |
| The log says `Base commit not available (the checkout needs fetch-depth: 0), skipping comparison.` | The checkout step fetched only the latest commit. | Add `with: { fetch-depth: 0 }` to `actions/checkout`. The generated workflow already has it. |
| The log says `Base run failed, see shipvo-base.log. The comment has no comparison.` | The flows could not run on the base commit. | Open `shipvo-base.log` in the `shipvo-check` artifact. The pull request result still counts. |
| No comment appears on a pull request from a fork | The token on fork pull requests is read-only (GitHub answers 403). | Expected. The check still runs and prints a notice; the reports are in the artifact. |
| No comment appears on your own pull requests | The workflow lacks `pull-requests: write`. | Add that permission to the job. |
| The check fails but the flow passes locally | A flaky flow that passed on base and failed now is counted as a regression. | Re-run the job. If it fails twice, the failure is real. |
| `shipvo explore` walks the whole app, not the changed screens | No `expo.scheme` in `app.json`, or no full history. | Set `expo.scheme`, add an `onUrl` listener and use `fetch-depth: 0`. |
| Locally, `Port 4545 is in use` | Another simulator is running. | Stop it, or pass `--port <n>`. |

## Next steps

- [Write flows to check](testing.md)
- [Let Lumi walk the app and save findings as tests](lumi.md)
- [Compare behaviour between releases](timeline.md)
- [Ship the fix when the check is green](getting-started.md#5-publish-over-the-air)
