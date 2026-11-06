# First-run timing

`apply-ios.mjs` reads the marks file and server log from an iOS Simulator run and prints how long the first applied OTA took.

Timed: `shipvo publish`, the download, the apply, and the runtime reporting healthy on the iOS Simulator.

Not timed: store builds, installing the app on the Simulator, reading docs, and `npm install`.

The script does not launch the Simulator. A workflow does that and writes the inputs. See the header of `apply-ios.mjs`.
