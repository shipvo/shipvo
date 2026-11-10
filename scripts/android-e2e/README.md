# Android device lab

Runs the over-the-air scenarios on a booted Android emulator (x86_64) against a local release server, and writes `android-e2e-report.json`. It uses the CLI's signing code and the runtime as they are.

Pieces:

- `build-apk.sh <publicKey> <port> <out.apk>`: builds the sample shell with the runtime pointed at `http://10.0.2.2:<port>` and a test key. The test build allows cleartext http and is debuggable so `run-as` can read the runtime state. `app.json` is restored afterwards.
- `make-bundles.sh <dir> [count]`: exports `v1.hbc` to `v<count>.hbc` (headline changed each time) and `crash.hbc` (throws at start).
- `server.mjs`: static release server that logs every request, including telemetry, as JSON lines.
- `release.mjs`: signs and publishes one release (bundle, bsdiff patches, pointer per band), with `--tamper signature|hash|size`.
- `run.mjs`: starts the server in-process, runs the scenarios, and writes the report.

Run (needs `pnpm --filter @shipvo/store build` and `pnpm --filter @shipvo/cli build` (the CLI imports the store package; patches come from the built CLI, no Python needed), and `adb` with one emulator):

```bash
node scripts/ios-e2e/keygen.mjs > key.json
scripts/android-e2e/build-apk.sh "$(node -p 'require("./key.json").publicKey')" 8110 shell.apk
scripts/android-e2e/make-bundles.sh bundles 10
node scripts/android-e2e/run.mjs --apk shell.apk --bundles bundles --key key.json
```

Tests for the helpers: `node --test scripts/android-e2e/*.test.mjs`. Build `@shipvo/schema` and `@shipvo/cli` first, because the tests import `packages/cli/dist`. `pnpm -r test` does not run these tests, and no workflow does yet (`.github/` is locked, so a human has to wire them in).

Build note: `build-apk.sh` passes `-x lintVitalRelease`. Lint rejects the hardcoded `debuggable` flag that the harness needs for `run-as`.

How times are taken: the server and the runner share one clock. "Pointer published" is the time the pointer file became visible. "Healthy" is the time the server received the app's `applied` telemetry for the new release (sent after `markHealthy`). The app polls every 10 s while open, so pointer-to-healthy includes up to one poll interval.

Run time: a full run takes about 18 minutes (the crash-loop scenarios alone take about 10). If you run it from a tool with a time limit, set the limit above 20 minutes. The staged-rollout scenario runs before the crash-loop scenarios on purpose: a failed late-crash run leaves the app open with a dead React host, and the staged check needs a device that is polling.

## Rollback scenario

`on-device Runtime.rollback(): previous release restored and kept after a restart` publishes release A, then B (both healthy), taps the sample app's "Roll back to previous release" button (found with `uiautomator dump`), and times the call until the server receives `applied` telemetry for A (`rollbackToGoodActiveMs`). It then waits for two or more check-ins while the pointer still names B, force-stops and relaunches, and checks that A runs, B is blocked and was not downloaded again, and `rolled_back` telemetry arrived. The app reports that event under the release that is running when it is sent, so the scenario looks for it under A. If B comes back after the relaunch, the scenario fails and the row says so. The `rolled_back` event is sent when the app next mounts.

## Patch update timeline

The patch scenario runs `--patch-trials` trials (default 5). Each trial records a `timeline`: pointer seen, patch received, staged (runtime finished download and verify) and healthy (`applied` telemetry after `markHealthy`), all in ms after publish, from the server log and telemetry. `phaseMedianMs` in the report gives the median gap between phases and `unaccountedMs`, the time that the runtime's own download and apply numbers do not explain. Poll misses (pointer fetched more than 3 s after publish) and the trial after one are left out of the median. The scenario needs `v1` to `v10` bundles (`make-bundles.sh bundles 10`).

## Resumed download scenario

"resumed download: an interrupted bundle download resumes with Range" publishes a full-bundle release (no patch) while the server cuts the first response of that bundle at half its bytes (`startServer(..., { cutFirst: { path, fraction } })`; the option is off for every other scenario). The app must retry on a later poll, send `Range: bytes=<n>-`, get a 206, and report the release healthy. The scenario fails, and says why in `failure`, if the first response was not cut, the app did not retry, the second request had no `Range`, the answer was not 206, or the release never became healthy. The report records `bytesSentTotal`, `secondRequestUsedRange` (with the header and status) and `firstRequestToHealthyMs`. The retry waits for the next poll, so the time includes up to one poll interval. No numbers from this scenario are published until a CI run has produced them.
