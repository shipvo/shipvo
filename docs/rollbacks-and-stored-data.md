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

The rollback is recorded in the audit log (`shipvo audit <app>`) with the `from` and `to` versions.

## Read it in the app

```ts
import { getAppliedStateVersion } from "@shipvo/runtime";
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function openStore() {
  const running = getAppliedStateVersion(); // 0 when the release declares none
  const written = Number((await AsyncStorage.getItem("state_version")) ?? 0);
  if (written > running) return { mode: "read-only" as const }; // newer data: do not rewrite it
  if (written < running) { /* migrate here */ await AsyncStorage.setItem("state_version", String(running)); }
  return { mode: "read-write" as const };
}
```

## Automatic revert

After a crash loop, the runtime goes back to the newest earlier release whose `state_version` is not lower than the phone's own, or to the embedded bundle. `pickRevertTarget` from `@shipvo/runtime` holds that rule. The `crash_loop_revert` event records `state_version_from` and `state_version_to`.
