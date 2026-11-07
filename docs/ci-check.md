# Check every pull request

This page is for anyone who owns a Shipvo app on GitHub and wants every pull request tested before it merges. You get one check that builds the app, runs your flows, walks the screens that changed on Android and iOS, and posts one comment with the result. A failing flow or a crash fails the check. Exploration notes do not.

If you are not technical, paste the three setup commands below to your coding agent and ask it to open a pull request. After that the check runs by itself.

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

A flaky flow can fail on the pull request and pass on base, and then the check fails. Re-run the job once: a flow that fails again on the pull request is a regression, and one that passes on re-run is flaky. Flows that are new on the pull request and fail are listed under "New flows" but do not fail the check.


### Before and after screens

With `--before-shots <dir> --after-shots <dir>` (each laid out as `<dir>/android/<screen>.png` and `<dir>/ios/<screen>.png`), the comment has a "Before and after" section. Each screen gets a table with an Android row and an iOS row, and a Before and an After column. Changed screens come first; up to six are shown and the rest are counted.

On a public repository the workflow's token uploads the images to the `shipvo-media` branch of your own repository, so the workflow needs `contents: write`. The comment shows the images inline. Each push uploads its own copies, and the comment is updated in place. A file that is already there counts as uploaded only when it holds the same bytes.

On a private repository, or when the repository cannot be read, nothing is uploaded. The comment lists the file names for each screen and skin, and the images are in the folders you passed to `--before-shots` and `--after-shots`. Upload those folders as an artifact in your workflow to keep them.

## Troubleshooting

| You see | Why | What to do |
| --- | --- | --- |
| No comment appears on the pull request | The workflow lacks `pull-requests: write`, or the pull request comes from a fork (the token is read-only there). The check still runs. | Add `pull-requests: write` to the workflow permissions. For forks, read the result in the job log. |
| The log says it is walking the whole app, not only changed screens | The checkout has no history (`fetch-depth: 0` is missing), or `app.json` has no `expo.scheme`. | Keep `fetch-depth: 0` as in the generated workflow, and set `expo.scheme`. |
| "Compared with base" is missing | The base report is missing or unreadable, or the base commit could not be checked out. The log says which. | Fix the base build. The check does not fail for this. |
| The check fails on a flow you did not touch | The flow passed on base and failed on the pull request. | Re-run the job once. If it fails again, it is a regression: read the first failing step in the comment. If it passes, it is flaky. |
| Before and after images are file names, not pictures | The repository is private, so nothing is uploaded. | Upload `shipvo-shots-before/` and `shipvo-shots-after/` as an artifact, or open the `shipvo-check` artifact. |
| A changed screen is not in the screenshots | Dynamic screens such as `[id]` and layouts are skipped, and only four screens are captured. | Add the screen as a flow in `tests/`. |

## Next steps

- [Test your app in CI](testing.md): write the flows the check runs.
- [Agents](agents.md): what `shipvo explore` looks for.
- [Lumi](lumi.md): turn a finding into a test with Save as test.
- [Glossary](glossary.md)
