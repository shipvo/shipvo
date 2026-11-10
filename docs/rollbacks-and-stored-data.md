# Rollbacks and stored data

This page is for anyone who ships updates that change what an app saves on the phone (settings, carts, notes). You will learn how to tell Shipvo which format your release uses, so a rollback never sends phones to code that cannot read their saved data.

A rollback sends phones back to older code. If the newer release already changed the format of data in AsyncStorage, SQLite or MMKV, the older code may crash or damage that data. A release can declare the format it uses, and `shipvo rollback` checks it before it sends phones back. This works the same for Android and iOS.

## Declare a state version

1. Open `shipvo.json`.
2. Add `stateVersion`, a positive integer. Raise it whenever a release changes how stored data is laid out.

```json
{ "appId": "tide", "stateVersion": 3 }
```

3. Run `shipvo publish`. It signs the number into the release as `state_version`. Releases without it work as before.

If `stateVersion` is not a positive integer (for example `0`, `2.5` or `"3"`), `shipvo publish` stops with `shipvo.json: stateVersion must be a positive integer`.

## Roll back

`shipvo rollback --to <release>` compares the target release with the highest `state_version` on the bands you are rolling back (all three by default; use `--bands` to choose). It checks each platform you roll back.

If the target has a lower `state_version` than the one phones run, it stops and says so:

```
Release 5 (android) has state_version 2, but phones already run state_version 3. Older code may not read data the newer release stored. Publish a fix forward, or pass --allow-state-downgrade to roll back anyway. The choice is recorded in the audit log.
```

A target with no `state_version` counts as `none`, which is lower than any number. So rolling back from a release that declares one to a release that does not also stops.

You have two ways forward:

- **Publish a fix forward.** Ship a new release with the fix and the same or a higher `stateVersion`. This is the safe choice.
- **Roll back on purpose**, if you know the older code can read the data:

  ```bash
  shipvo rollback --to 5 --allow-state-downgrade
  ```

A `--dry-run` hits the same check. To preview a rollback that lowers the version, pass `--dry-run --allow-state-downgrade`; the `--json` output then lists `state_downgrade` with `platform`, `from` and `to`.

With `--json`, the refusal has code `state_downgrade` and a `next` command that repeats the rollback with `--allow-state-downgrade`.

## See it in the audit log

The control plane records a rollback that lowers `state_version` in the audit log with the `from` and `to` versions:

```bash
shipvo audit <app>
```

## Troubleshooting

| You see | Why | What to do |
| --- | --- | --- |
| `has state_version 2, but phones already run state_version 3` | The release you chose stores data in an older format. | Publish a fix forward, or add `--allow-state-downgrade` if the older code can read the newer data. |
| Rollback stops although you never set `stateVersion` on the old release | Releases published before you started using `stateVersion` have none, and a newer release declares one. | Same two choices. Set `stateVersion` from your next publish on. |
| `stateVersion must be a positive integer` | `shipvo.json` holds `0`, a decimal, a string or a negative number. | Use a whole number from 1 up. |
| `--dry-run` stops with the `state_downgrade` refusal | The preview runs the same check as the real rollback. | Pass `--dry-run --allow-state-downgrade` to preview a rollback that lowers the version. |

## Next steps

- [CLI guide](cli.md): `shipvo rollback`, `--json` output and `shipvo audit`.
- [Key rotation](key-rotation.md): change the key that signs your releases.
- [Glossary](glossary.md): state version, band and rollback in plain words.
