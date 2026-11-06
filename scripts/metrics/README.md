# Adoption metrics

Reads the public numbers in the "Input metrics" table of `docs/product/strategy.md` and prints one JSON object. It only reads. Node 22, no dependencies.

```bash
node scripts/metrics/adoption.mjs
node scripts/metrics/adoption.mjs --out /tmp/adoption.json --strict
```

Set `GITHUB_TOKEN` to raise the GitHub rate limit. It is sent only to `api.github.com` and is never printed.

Options:
- `--team <a,b>`: logins that do not count as outside authors. Default: `claude[bot]`, `github-actions[bot]` and the repo owner login from the API.
- `--out <file>`: also write the JSON to a file.
- `--strict`: exit 1 if any call failed. Default is exit 0.

Fields:
- `npm`: last-week downloads per package (`https://api.npmjs.org/downloads/point/last-week/<pkg>`). Covers every non-private package in `packages/` (`@shipvo/*`, `shipvo`, `create-shipvo`).
- `github.stars`, `github.forks`: from `shipvo/shipvo`.
- `github.outsideIssues`: issues and PRs (any state) whose author is not in the team list. Reads up to 20 pages of 100.
- `readAt`: ISO date and time of the read.
- `errors`: one `{ url, status }` per failed call (`status` 0 means no response; a `message` explains). The matching field is `null`.

Test: `node --test scripts/metrics/adoption.test.mjs`
