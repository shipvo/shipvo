# Rollbacks and stored data

For app owners who roll back a bad release. A rollback sends phones back to older code. If the newer release already changed how your app saves data on the phone (AsyncStorage, SQLite or MMKV), the older code may crash or damage that data. You will learn how to tell Shipvo which data format each release uses, so `shipvo rollback` stops before it sends phones to code that cannot read their data. This works the same for Android and iOS.

## Declare a state version

The state version is a whole number you choose. Raise it whenever a release changes the layout of stored data. Releases that keep the same layout keep the same number.

1. Open `shipvo.json` in your project.
2. Add `stateVersion` as a positive integer:

   ```json
   { "appId": "tide", "stateVersion": 3 }
   ```

3. Run `shipvo publish` as usual. The number is signed into the release with the rest of it.

Releases without `stateVersion` work as before. A value that is not a whole number of 1 or more stops `shipvo publish` with `shipvo.json: stateVersion must be a positive integer`.

## Roll back

`shipvo rollback --to <release>` compares the target release with the highest `state_version` among the bands it changes (`b0,b1,b2` unless you pass `--bands`). If the target is lower, or has none, the command stops and prints what to do:

```
Release 5 (android) has state_version 2, but phones already run state_version 3. Older code may not read data the newer release stored. Publish a fix forward, or pass --allow-state-downgrade to roll back anyway. The choice is recorded in the audit log.
```

Nothing is written. You have two choices:

- **Publish a fix forward.** Ship a new release that has the old behaviour and still reads the new data format. This is the safe choice.
- **Roll back on purpose.** You accept that phones may lose or fail to read the newer data:

  ```bash
  shipvo rollback --to 5 --allow-state-downgrade
  ```

Rollbacks to the same or a higher state version need no flag. `shipvo rollback --dry-run` shows what would happen, and with `--allow-state-downgrade` it lists the downgrade under `state_downgrade` in the result.

## What gets recorded

The rolled-back release keeps the target's `state_version`. The control plane records a rollback that lowers it in the audit log with the `from` and `to` versions. Read it with `shipvo audit <app>`.

## With `--json`

Without `--allow-state-downgrade`, `shipvo rollback --json` fails with `code` `state_downgrade`. The `next` field holds the same command with the flag added. A rollback that goes ahead adds `data.state_downgrade`, a list of `{ platform, from, to }`.

## Troubleshooting

| You see | What it means | What to do |
| --- | --- | --- |
| `has state_version none, but phones already run state_version 3` | The release you chose was published without `stateVersion`. | Publish a fix forward, or add `--allow-state-downgrade`. |
| `shipvo.json: stateVersion must be a positive integer` | The value is `0`, negative, a decimal or text. | Use `1`, `2`, `3` and so on, without quotes. |
| The rollback stops and you did not expect it | A newer release set a higher `stateVersion`. | Run `shipvo status` to see the releases. Decide whether the data format changed. |
| You want to be sure before you run it | | Run `shipvo rollback --to <release> --dry-run` first. |

## Next steps

- [CLI guide](cli.md) for every command and its `--json` output.
- [Moving to a new machine](new-machine.md) and [Key rotation](key-rotation.md) for the signing keys behind every release.
- [Glossary](glossary.md) for state version and rollback.
