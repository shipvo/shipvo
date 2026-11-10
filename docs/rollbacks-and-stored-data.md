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
