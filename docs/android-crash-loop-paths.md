# Crash-loop revert: trial boots and promoted boots

This page is for developers who want to know exactly when an Android phone gives up on a release that keeps crashing, and why two cases behave a little differently. You will learn the two paths, the numbers they use and where they live in the code.

A release that crashes on start is reverted by one of two paths. Both allow 3 runs. They are timed differently.

| | Trial path | Promoted path |
| --- | --- | --- |
| Release state | `pending_release`, never marked healthy | Calls `markHealthy`, then becomes `current_release` |
| Counter | `trial_boots`, one per boot | Boot count inside a time window |
| Reverts at | `MAX_BOOTS` (3) boots | Count passes `MAX_BOOTS` (3) |
| Time window | None | `WINDOW_MS` (60 s) |
| Code | `ShipvoHostHandler.kt` | `ShipvoRuntimeModule.kt`, `BootRules.kt` |

## Trial path

The runtime stages a release as `pending_release`. Each boot of it adds to `trial_boots`. At 3 the release is blocked and the previous one comes back. There is no time window.

## Promoted path

If the release calls `markHealthy` before it crashes, `ShipvoRuntimeModule.kt` promotes it: `current_release` is set and the promoting boot is counted once by `BootRules.countPromotedBoot`. Later boots use `BootRules.countBoot`, which reverts when the count passes 3. The count lives inside a 60 s window: if the first counted boot is older than 60 s, the count restarts at 1.

So the number of runs is the same, and the promoted path can take longer when boots are more than 60 s apart. A release that survives that long is not treated as a tight crash loop.

## See which path a test took

The Android end-to-end harness (`scripts/android-e2e/run.mjs`) records the state it saw in each crash-loop trial as `reached`:

- `"pending"`: the release was still on trial. `staged` is true.
- `"current"`: the release was already promoted before the first poll.
- `null`: the harness never saw the release.

Measured crash-loop revert on a real phone: after 3 failed boots the release was discarded and blocked, and the phone came back on the previous release without downloading the bad one again. The timeline is in [OTA on a 2 GB phone](spike-results.md).

## Troubleshooting

- **A crashing release is still running after 3 launches.** If it called `markHealthy` first, it is on the promoted path. Launches more than 60 s apart restart the count. Reopen it quickly three times, or publish a rollback with `shipvo rollback`.
- **The phone went back to the old release and does not retry the new one.** That is the block working. Publish a fixed release with a new version.
- **A test reports `reached: null`.** The harness did not see the release staged. Check that the publish finished and the shell version matches.

## Next steps

- [OTA on a 2 GB phone](spike-results.md): the measured timeline.
- [Rollbacks and stored data](rollbacks-and-stored-data.md): roll back on purpose.
- [@shipvo/runtime](../packages/runtime/README.md): the module that does this on the phone.
