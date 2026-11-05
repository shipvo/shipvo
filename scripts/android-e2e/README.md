# Android device lab

Runs the over-the-air scenarios on a booted Android emulator (x86_64) against a local release server, and writes `android-e2e-report.json`. It uses the CLI's signing code and the runtime as they are.

Pieces:

- `build-apk.sh <publicKey> <port> <out.apk>`: builds the sample shell with the runtime pointed at `http://10.0.2.2:<port>` and a test key. The test build allows cleartext http and is debuggable so `run-as` can read the runtime state. `app.json` is restored afterwards.
- `make-bundles.sh <dir> [count]`: exports `v1.hbc` to `v<count>.hbc` (headline changed each time) and `crash.hbc` (throws at start).
- `server.mjs`: static release server that logs every request, including telemetry, as JSON lines.
- `release.mjs`: signs and publishes one release (bundle, bsdiff patches, pointer per band), with `--tamper signature|hash|size`.
- `run.mjs`: starts the server in-process, runs the scenarios, and writes the report.
  Before the staged-rollout scenario it publishes a known good release and waits for it to be healthy. If that fails, it records a failed scenario instead of running staged rollout on a bad device.

Run (needs `pnpm --filter @shipvo/cli build`, `pip install bsdiff4`, and `adb` with one emulator):

```bash
node scripts/ios-e2e/keygen.mjs > key.json
scripts/android-e2e/build-apk.sh "$(node -p 'require("./key.json").publicKey')" 8110 shell.apk
scripts/android-e2e/make-bundles.sh bundles 8
node scripts/android-e2e/run.mjs --apk shell.apk --bundles bundles --key key.json
```

Tests for the helpers: `node --test scripts/android-e2e/*.test.mjs`. Build `@shipvo/schema` and `@shipvo/cli` first, because the tests import `packages/cli/dist`. `pnpm -r test` does not run these tests, and no workflow does yet (`.github/` is locked, so a human has to wire them in). The bsdiff patch test is skipped when `bsdiff4` is missing, unless the `CI` env var is set; then it fails.

Build note: `build-apk.sh` passes `-x lintVitalRelease`. Lint rejects the hardcoded `debuggable` flag that the harness needs for `run-as`.

How times are taken: the server and the runner share one clock. "Pointer published" is the time the pointer file became visible. "Healthy" is the time the server received the app's `applied` telemetry for the new release (sent after `markHealthy`). The app polls every 10 s while open, so pointer-to-healthy includes up to one poll interval.
