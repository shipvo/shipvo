# Publish details

- Cohorts are bands `b0`, `b1`, `b2`. `shipvo publish --bands b0` starts small; `shipvo promote` widens the same release.
- `shipvo promote --report report.json` refuses to widen when a flow failed for this release.
- `shipvo publish --dry-run --out dir` writes the signed release locally; check it with `shipvo verify <pointer>`.
- `shipvo rollback --to <n> --dry-run` previews a rollback.
- A `policy` section in `shipvo.json` can restrict bands; `shipvo publish --dry-run-policy` checks it.
- Full guide: `docs/cli.md` in the Shipvo repo.
