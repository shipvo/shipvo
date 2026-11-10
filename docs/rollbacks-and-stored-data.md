# Rollbacks and stored data

This page is for developers who store data on the phone (AsyncStorage, SQLite, MMKV) and want to roll back safely. You will learn how to declare a data format version and what `shipvo rollback` does with it.

A rollback sends phones back to older code. If the newer release already changed the format of data in AsyncStorage, SQLite or MMKV, the older code may crash or damage that data. A release can declare the format it uses, and Shipvo checks it before it sends phones back.

## Declare a state version

Set `stateVersion` in `shipvo.json`. It is a positive integer. Raise it whenever a release changes how stored data is laid out.

```json
{ "appId": "tide", "stateVersion": 3 }
```

`shipvo publish` signs the number into the release. Releases without it work as before.

## Roll back

If the target release has a lower `state_version` than the one phones run, `shipvo rollback` stops and says so:

```
Release 5 (android) has state_version 2, but phones already run state_version 3. ...
```

Publish a fix forward, or choose the rollback on purpose:

```bash
shipvo rollback --to 5 --allow-state-downgrade
```

The control plane records a rollback that lowers `state_version` in the audit log (`shipvo audit <app>`) with the `from` and `to` versions.

## Steps

1. Add `"stateVersion": 1` to `shipvo.json`.
2. Run `shipvo publish`. The number is signed into the release.
3. When a later release changes how stored data is laid out, raise the number and publish again.
4. To go back, run `shipvo rollback --to <release> --dry-run` first. It tells you if the rollback would lower the version.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `shipvo.json: stateVersion must be a positive integer` | Use a whole number of 1 or more, not text or a decimal. |
| `shipvo rollback` stops with `has state_version ... but phones already run state_version ...` | The older code may not read the newer data. Publish a fix forward, or add `--allow-state-downgrade` if you have checked it is safe. |
| Rollback works without any warning | The release you roll back to has no `stateVersion`, or the same or a higher one. Releases without it are not checked. |

## Next steps

- [Command reference](cli.md): `shipvo rollback` and `shipvo audit`.
- [Ship an update to phones](getting-started.md#5-publish-over-the-air)
- [Words explained](glossary.md)
