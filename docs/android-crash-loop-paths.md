# Crash-loop revert: trial boots and promoted boots

A release that crashes on start is reverted by one of two paths. Both allow 3 runs. They are not timed the same way.

**Trial path.** The runtime stages a release as `pending_release`. Each boot of it adds to `trial_boots` (`ShipvoHostHandler.kt`). At `MAX_BOOTS` (3) the release is blocked and the previous one comes back. There is no time window.

**Promoted path.** If the release calls `markHealthy` before it crashes, `ShipvoRuntimeModule.kt` promotes it: `current_release` is set and the promoting boot is counted once by `BootRules.countPromotedBoot`. Later boots use `BootRules.countBoot`, which reverts when the count passes `MAX_BOOTS`. That count lives inside a `WINDOW_MS` (60 s) window: if the first counted boot is older than 60 s, the count restarts at 1.

So the number of runs is the same, but the promoted path can take longer when boots are more than 60 s apart, because the window resets the count. This is by design: a release that survives that long is not treated as a tight crash loop. It is a real runtime difference, not a harness artefact.

The Android e2e harness (`scripts/android-e2e/run.mjs`) records which state it saw in each crash-loop trial as `reached`: `"pending"`, `"current"` (already promoted before the first poll) or `null` (never seen). `staged` is true only for `"pending"`.

No timing for the promoted path is claimed here. The next device-lab run will report restore times split by `reached`; link them here once measured.
