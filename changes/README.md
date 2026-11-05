# Changelog entries waiting for the next release

Every pull request that changes something users notice adds **one new file here** instead of editing `CHANGELOG.md`. Many PRs land each day; separate files never conflict, one shared file always does.

- Name: `<issue number>-<short-name>.md`, for example `199-adopt-mode.md`.
- Content: one or more bullet lines in plain English, starting with the package, and a migration note when an exported API changes:

```md
- `@shipvo/cli`: `shipvo init` inside an existing Expo app makes it Shipvo-ready.
- Migration: none; new command.
```

The daily release train moves every file here into a dated section of `CHANGELOG.md` and deletes them. Do not edit `CHANGELOG.md` directly.
