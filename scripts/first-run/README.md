# First-run timing

`apply-ios.mjs` reads the marks file and server log from an iOS Simulator run and prints how long the first applied OTA took.

Timed: `shipvo publish`, the download, the apply, and the runtime reporting healthy on the iOS Simulator.

Not timed: store builds, installing the app on the Simulator, reading docs, and `npm install`.

The script does not launch the Simulator. A workflow does that and writes the inputs. See the header of `apply-ios.mjs`.

A run with no `/b/` request between `app_launched` and `healthy` is an error, not a zero. Download time starts at the first request after `app_launched`, as in `scripts/ios-e2e/analyze.mjs`. The `publish_start` and `publish_done` marks (`pointer_published` also works) are written by the workflow step that runs `shipvo publish`; no step writes them yet.

## One timeline per platform

`continuous.mjs` joins the JSON from one job into a single init-to-applied timeline: init, install, publish, download, apply, healthy, and a total. Each row names the script that measured it, the head commit and the run URL. The total is the sum of the rows in exact milliseconds.

```bash
node scripts/first-run/continuous.mjs \
  --android-measure first-run.json --android-applied applied-ota.json \
  --ios-measure first-run.json --ios-apply apply-ios.json \
  --commit "$GITHUB_SHA" --run-url "$RUN_URL"
```

Pass Android, iOS or both. Add `--json` for machine output. Set a commit or platform per input with `--<input>-commit` and `--<input>-platform` (inputs: `android-measure`, `android-applied`, `ios-measure`, `ios-apply`), or put a `meta` object in the file. Inputs of one platform with different commits, or an input for the other platform, exit 1 with a message.

Android: `applied-ota.mjs` reports publish and publish-to-healthy, so the row "download, apply, healthy" covers that span. iOS: `apply-ios.mjs` gives publish, download and apply; "healthy" is publish done to download start.

Sample output built from the fixtures in `continuous.test.mjs` (the numbers are fixture values, not a measured run):

```text
Android init to applied OTA (commit 0123456789abcdef)
1. init                           1200 ms  measure.mjs  0123456  https://example.test/runs/1  (shipvo init)
2. install                       30500 ms  measure.mjs  0123456  https://example.test/runs/1  (package install in the scaffolded app)
3. publish                        4100 ms  applied-ota.mjs  0123456  https://example.test/runs/1  (shipvo publish of the second release)
4. download, apply, healthy       9300 ms  applied-ota.mjs  0123456  https://example.test/runs/1  (publish done to current_release on the Android emulator)
   total                         45100 ms
```
