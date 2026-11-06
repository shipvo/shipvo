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

Run the same two commands locally with `npx shipvo ci check` while `npx shipvo sim --port 4545` is running.

Use `--force` to overwrite an existing workflow, and `--dry-run` to see it first.

## The pull request comment

On each pull request the check posts one comment and updates it on every push. It finds its own comment by a hidden marker, `<!-- shipvo-check -->`, so you never get a pile of them.

The comment shows:

- pass or fail for each flow;
- new crashes or runtime errors, dead ends and other problems from `shipvo explore`;
- up to four screenshots of the screens your diff changed, picked from files under `app/` or `screens/` since the base commit (`--changed-from <sha>`).

Screenshots are uploaded in the `shipvo-check` artifact of your own workflow run. The comment is built and posted by your workflow with its `GITHUB_TOKEN`. Nothing is sent to Shipvo. The workflow needs `pull-requests: write` for the comment; without it the check still runs and the comment is skipped.

Run it by hand with `npx shipvo ci comment --changed-from <sha> --pr <number>`. Without a token it prints the comment.

Not yet covered: recordings and comparing with the base branch.
