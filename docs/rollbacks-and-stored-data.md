# Rollbacks and stored data

This page is for developers whose app keeps data on the phone (AsyncStorage, SQLite or MMKV). You will learn how to tell Shipvo which data format a release uses, so a rollback on Android and iOS never sends phones back to code that cannot read their saved data.

A rollback sends phones back to older code. If the newer release already changed how stored data is laid out, the older code may crash or damage that data. A release can declare the format it uses, and Shipvo checks it before it sends phones back.

## Declare a state version

1. Open `shipvo.json` and add `stateVersion`. It is a positive integer. Raise it whenever a release changes how stored data is laid out.

   ```json
   { "appId": "tide", "stateVersion": 3 }
   ```

2. Publish as usual:

   ```bash
   npx shipvo publish
   ```

   `shipvo publish` signs the number into the release. Releases without it work as before.

## Roll back

```bash
npx shipvo rollback --to 5 --dry-run   # preview
npx shipvo rollback --to 5
```

If the target release has a lower `state_version` than the one phones run, `shipvo rollback` stops and says so:

```
Release 5 (android) has state_version 2, but phones already run state_version 3. Older code may not read data the newer release stored. Publish a fix forward, or pass --allow-state-downgrade to roll back anyway. The choice is recorded in the audit log.
```

Publish a fix forward, or choose the rollback on purpose:

```bash
shipvo rollback --to 5 --allow-state-downgrade
```

The control plane records a rollback that lowers `state_version` in the audit log (`shipvo audit <app>`) with the `from` and `to` versions.

## Options

| Option | Where | What it does |
| --- | --- | --- |
| `stateVersion` | `shipvo.json` | Positive integer signed into each release. Leave it out if your app stores nothing on the phone. |
| `--allow-state-downgrade` | `shipvo rollback` | Roll back to a release with a lower `state_version`. The audit log records it. |
| `--json` | `shipvo rollback` | A blocked rollback returns the error code `state_downgrade` and the command to run with `--allow-state-downgrade`. |

## Troubleshooting

| What you see | Why | What to do |
| --- | --- | --- |
| `shipvo.json: stateVersion must be a positive integer` (code `bad_config`) | The value is `0`, negative, a decimal or a string such as `"3"` | Write a whole number of 1 or more, without quotes |
| `shipvo rollback` stops with `state_version` in the message | Phones run a newer data format than the release you chose | Publish a fix forward, or add `--allow-state-downgrade` if you know the older code can read the data |
| The message says `state_version none` | The target release was published before you set `stateVersion` | Treat it as the oldest format; roll back only if that code can read the current data |

## Next steps

- [CLI guide](cli.md): every command, including `rollback` and `audit`
- [Glossary](glossary.md)
