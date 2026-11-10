# Rollbacks and stored data

A rollback sends phones back to older code. If newer code already changed the data your app stores (AsyncStorage, SQLite, MMKV), the older code may not read it. A release can declare the version of its data format, so Shipvo can check this for you.

## Declare a state version

Add `stateVersion` to `shipvo.json`. It is a positive whole number. Raise it whenever a release changes how stored data is written.

```json
{ "appId": "shop", "controlPlane": "https://cp.example.com", "publicKey": "...", "stateVersion": 3 }
```

`shipvo publish` signs it into the release as `state_version`. A release without it declares nothing, and nothing changes for that release.

## Roll back

```bash
shipvo rollback --to 2 --bands b0,b1,b2
```

If release 2 has a lower state version than the release phones run now, the command stops and says so. To roll back anyway:

```bash
shipvo rollback --to 2 --bands b0,b1,b2 --allow-state-downgrade
```

The audit log row for that rollback has `state_downgrade_allowed`, `state_version_from` and `state_version_to`. Read it with `shipvo audit <app>`.

## Read it in your app

```ts
import { getAppliedStateVersion } from "@shipvo/runtime";

const STORED = Number(await AsyncStorage.getItem("data_version") ?? 0);
const RUNNING = getAppliedStateVersion();

if (STORED > RUNNING) {
  // Newer code wrote this data. Do not read it as the old format.
  await AsyncStorage.clear();
} else if (STORED < RUNNING) {
  // Migrate the data up to the format this release uses.
}
await AsyncStorage.setItem("data_version", String(RUNNING));
```

`getAppliedStateVersion()` returns 0 when the running release declared none.

## Crash-loop reverts

`pickRevertTarget(from, candidates)` chooses the newest earlier release whose `stateVersion` is not lower than the device's, or `null` for the embedded bundle. The `crash_loop_revert` report carries `state_version_from` and `state_version_to` when the shell sends them.
