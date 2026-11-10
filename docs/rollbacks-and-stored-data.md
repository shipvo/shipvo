# Rollbacks and stored data

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

## Options

| Where | Option | What it does |
| --- | --- | --- |
| `shipvo.json` | `stateVersion` | Positive integer, signed into each release by `shipvo publish`. Leave it out if you never change stored data. |
| `shipvo rollback` | `--allow-state-downgrade` | Roll back even when the target's `state_version` is lower than the one phones run. |
| `shipvo rollback` | `--bands b0,b1,b2` | The check uses the highest `state_version` across the bands you chose. Default: `b0,b1,b2`. |
| `shipvo rollback` | `--json` | The refusal is returned with code `state_downgrade` and a ready-to-run command that adds the flag. |

## Troubleshooting

**Rollback stops with "has state_version none".** The target release was published without `stateVersion`, and phones run a release that has one. Publish a fix forward, or pass `--allow-state-downgrade` if you know the old code can read the data.

**I raised `stateVersion` but the check does not fire.** The check fires only when a release pointer that the rollback reads has a numeric `state_version` higher than the target's. So the release with the raised `stateVersion` must be published and live on those bands, and on the platform you roll back (Android or iOS). `--bands` limits which pointers are read. Run `shipvo rollback --to <n> --dry-run` to see it before anything changes.

**I want to see who chose a downgrade.** Run `shipvo audit <app>`. The entry lists `from` and `to`.

## Next steps

- [CLI guide](cli.md): `publish`, `rollback` and `--json` output.
- [Rollback in the CLI guide](cli.md#--json-for-publish-promote-rollback-and-auto-halt): the `--json` output of `rollback`.
- [Glossary](glossary.md): state version.
