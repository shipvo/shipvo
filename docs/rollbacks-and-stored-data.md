# Rollbacks and stored data

For app owners who store data on the phone (AsyncStorage, SQLite or MMKV) and want a safe rollback. You will declare which format of stored data each release uses, and Shipvo will stop a rollback that could send phones back to code that cannot read their data.

## Why this matters

A rollback sends phones back to older code. If a newer release already changed how data is laid out on the phone, the older code may crash or damage that data. A release can declare the format it uses. Before it moves phones back, `shipvo rollback` compares the two numbers.

## 1. Declare a state version

Set `stateVersion` in `shipvo.json`. It is a positive integer. Raise it whenever a release changes how stored data is laid out. Leave it alone when the layout stays the same.

```json
{ "appId": "tide", "stateVersion": 3 }
```

`shipvo publish` signs the number into the release as `state_version`. Releases without it work as before. A value that is not a positive whole number stops the publish:

```
shipvo.json: stateVersion must be a positive integer (got 0).
```

## 2. Roll back

```bash
shipvo rollback --to 5
```

If phones already run a higher `state_version` than release 5 declares (or release 5 declares none), the command stops with exit code 1 and does not republish the platform that failed the check:

```
Release 5 (android) has state_version 2, but phones already run state_version 3. Older code may not read data the newer release stored. Publish a fix forward, or pass --allow-state-downgrade to roll back anyway. The choice is recorded in the audit log.
```

With `--json` the same stop is reported with the error code `state_downgrade`, and the suggested next command includes `--allow-state-downgrade`. A rollback that goes ahead adds `data.state_downgrade`, a list of `{ platform, from, to }`.

`shipvo rollback --to 5 --dry-run` runs the same check and also exits with code 1 on a downgrade, so you can use it as the check.

If the target has the same or a higher `state_version`, the rollback goes ahead with no flag.

## 3. Choose on purpose

Two ways forward:

- **Publish a fix forward.** Ship a new release that reads both formats.
- **Roll back anyway.** You accept that older code will meet newer data:

```bash
shipvo rollback --to 5 --allow-state-downgrade
```

The control plane records a rollback that lowers `state_version` in the audit log, with the `from` and `to` numbers:

```bash
shipvo audit tide
```

## Troubleshooting

**The rollback stops and I did not set `stateVersion`.** The target release declares none, and a newer release does. Phones already run that newer number. Add `stateVersion` to the releases that change stored data, or pass `--allow-state-downgrade` if you are sure the data is safe.

**I use `--bands` or `--platform`.** The check uses the highest `state_version` across the bands you name, for each platform, so a rollback of one band is still checked against what phones in it run.

**I roll back to an old release and nothing stops me.** Releases published before you set `stateVersion` carry no number. A rollback stops only when phones run a higher `state_version` than the target, so you can roll back freely to a release with no number when phones run none either.

**I roll back with `--platform all`.** Each platform is checked and republished in turn, Android first. If iOS fails the check, the command exits 1 after Android is already republished. Run `shipvo rollback --platform ios --to 5 --dry-run` first to check each platform, or roll back one platform at a time.

## Next steps

- [CLI guide](cli.md#shipvo-rollback): every `shipvo rollback` option.
- [Auto-halt](auto-halt.md): stop a bad release before it reaches every phone.
- [Glossary](glossary.md): state version.
