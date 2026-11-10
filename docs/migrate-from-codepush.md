# Migrate from CodePush to Shipvo

This guide is for developers of an Expo-based React Native app that ships updates with CodePush. You will end with the same app receiving signed Shipvo updates, with staged rollout and rollback.

This guide moves a React Native app that used `react-native-code-push` to Shipvo over-the-air (OTA) updates. Every command and flag below comes from `packages/cli` (`src/help.ts`, `src/init.ts`, `src/publish.ts`). The dry-run output was captured by running the CLI on the sample app in this repo.

Run `shipvo migrate --plan` in your app first. It is read-only. It lists what it finds with file and line (the `react-native-code-push` dependency, `codePush()` and `CodePush.sync` calls, `CodePushDeploymentKey` and `CodePushPublicKey` in `Info.plist` and `strings.xml`, and `appcenter codepush` commands in `package.json` and CI files) and prints the steps in order. `--json` returns the same data.

`shipvo migrate --apply` makes the code edits for you (see [shipvo migrate --apply](cli.md#shipvo-migrate---apply)): it swaps the `codePush()` wrapper and `CodePush.sync` calls for `@shipvo/runtime` calls, removes the native keys, and swaps the dependency in `package.json`. It does not run the package manager, does not edit `appcenter codepush` scripts or CI files (it prints them as manual steps), and refuses a dirty git tree unless you pass `--force`. Review the diff with `git diff`. It does not edit native bootstrap code. Files such as `MainApplication.java`, `MainApplication.kt`, `AppDelegate.m`, `AppDelegate.mm`, `AppDelegate.swift`, `settings.gradle`, `app/build.gradle` and the `Podfile` often still call CodePush (for example `CodePush.getJSBundleFile()` or `[CodePush bundleURL]`). Change those by hand, or the native build fails once the dependency is gone. `--apply` lists every such file with its line under the manual steps. You still create the Shipvo config (Step 1) and ship one new store build.

`--rollout <n>` has no direct equivalent. Shipvo uses cohort bands (`--bands`, then `shipvo promote`).

## What maps to what

CodePush facts are from the [react-native-code-push README](https://github.com/microsoft/react-native-code-push#readme) and its [docs folder](https://github.com/microsoft/react-native-code-push/tree/master/docs).

| CodePush | Shipvo | Notes |
| --- | --- | --- |
| Deployment key (`CodePushDeploymentKey` in `Info.plist` or `strings.xml`) | `appId` and `controlPlane` in `shipvo.json`, passed to the `@shipvo/runtime` plugin in `app.json` | There is no per-environment secret key in the app. The shell trusts one control plane URL and one public key. |
| `appcenter codepush release-react` | `shipvo publish` | Builds the bundle, signs it, publishes it. |
| `--rollout 25` | `--bands b0,b1,b2` | Shipvo releases to cohorts (bands), not a free percentage. The default is all three, `b0,b1,b2`. |
| `appcenter codepush rollback` | `shipvo rollback --to <release>` | Republishes an earlier release as a new release number. |
| Code signing (`CodePushPublicKey`, `--privateKeyPath`) | Ed25519 key made by `shipvo init`, public key pinned in the shell | Signing is always on. The seed is in `.shipvo/seed.txt` or `SHIPVO_SIGNING_SEED`. |
| Client-side rollback after a crash | Crash-loop revert | After three failed boots the runtime goes back to the last good bundle. Measured in [spike-results.md](spike-results.md). |

## Before you start

- Node 22.
- An Expo-based React Native app. `shipvo publish` runs `npx expo export`, and the runtime ships as an Expo config plugin.
- A control plane: the hosted one (`shipvo login`, then `shipvo app create`) or your own ([self-hosting.md](self-hosting.md)).

## Step 1. Create a Shipvo config

`shipvo init <dir>` creates a new app. It refuses to write into a folder that exists, so it cannot change your app in place. Run it in a scratch folder and copy what you need:

```bash
npx -y @shipvo/cli init shipvo-scratch --app-id myshop --name "My Shop"
```

From `shipvo-scratch` take:

1. `shipvo.json` to the root of your app.
2. The `@shipvo/runtime` entry from the `plugins` list in `app.json`. It holds `baseUrl`, `publicKey`, `appId` and `shellMajor`.
3. `.shipvo/seed.txt`, your signing seed. It is git-ignored. Back it up (`shipvo keys export`) and keep a copy offline. If you lose it, installed apps will not accept another update. See [new-machine.md](new-machine.md).

Other `init` flags: `--control-plane URL`, `--public-key B64` (use an existing key, then no seed is made), `--bundle-id`.

Then install the runtime and CLI in your app:

```bash
npm install @shipvo/runtime @shipvo/device
npm install --save-dev @shipvo/cli
```

## Step 2. Swap the update code

In the same release, remove `react-native-code-push` and call the Shipvo runtime so no build has two update mechanisms. The sample code in the file `App.tsx` that `init` writes shows the calls: `Runtime.markHealthy()` once the first screen renders, and `Runtime.checkForUpdate(true)` to look for a release. Copy that pattern.

Remove the CodePush deployment key and public key from `Info.plist` and `strings.xml`. `shipvo migrate --apply` does steps like these for single-line calls.

## Step 3. Check the setup

```bash
npx shipvo doctor
```

Each line starts with PASS or FAIL. A FAIL line ends with the fix.

## Step 4. Dry run

```bash
npx shipvo publish --dry-run --out .shipvo/dry-run
```

This builds and signs a release and writes files locally. It sends nothing. `--out` defaults to `.shipvo/dry-run`. A dry run builds no patches. Unknown flags are errors, so a typo like `--dryrun` cannot start a real publish.

Output from the sample app (`apps/tide-and-tackle`, with a throwaway key; the Metro progress lines are left out):

```
native modules this release requires: none found
dry run: nothing is sent anywhere; files go to /tmp/agent/dry. No patches are built offline. Release is 1 (pass --release N to match the control plane).
...
Exported: dist-ota
patches: none
...
Exported: dist-web
Dry run complete. Nothing was sent.
  Release:  1
  Size:     1.79 MB
  Files:    /tmp/agent/dry
Full bundles are fine for a first release. Small patches matter once you have older releases to compare against.
```

The pointer files are under `p/<appId>/<shell major>/<band>`. Check one with `shipvo verify <pointer> [public-key-b64]`.

## Step 5. Ship the store build

Build and submit one new binary with the Shipvo plugin and your public key in it. Users on the old CodePush build keep running their last CodePush bundle. They get Shipvo updates only after they install this binary. Shipvo cannot update a build that does not contain its runtime.

## Step 6. Publish

```bash
npx shipvo publish --bands b0
```

Watch crash rates, then widen the same release:

```bash
npx shipvo promote
```

`promote` copies the release on `b0` to `b1` and `b2` with a new signature. It does not rebuild, so the release you watched is the one everyone gets. It refuses a halted release or one with reported reverts unless you pass `--force`. Use `--to b1` to widen one band at a time, `--platform android|ios|all`, and `--dry-run` to preview. Running `shipvo publish` again would build a new release number instead.

Useful flags: `--platform android|ios|all` (default `android`), `--release N`, `--min-shell X.Y.Z`, `--max-bases N`. Run `shipvo publish --help` for the full list.

For speed numbers, see [spike-results.md](spike-results.md). Those were measured on one phone and apply only to that setup.

## Step 7. Roll back

```bash
npx shipvo rollback --to 3 --dry-run   # preview
npx shipvo rollback --to 3
```

This signs the code of release 3 as the next release number and publishes it to the bands you name (default all). It needs the control plane, so the preview reads from it too. `--bands` and `--platform` work as in `publish`.

## How Shipvo differs from CodePush

- Your signing seed stays with you. Every release is signed, and installed apps check the signature.
- Rollout goes by cohort (`b0`, `b1`, `b2`). You choose which cohorts get a release with `--bands`.
- Binary compatibility is set with `--min-shell` and the native module check in `publish`.
- Apps receive updates through `@shipvo/runtime`, which Step 2 adds.
- `publish` calls `expo export` to build the bundle, so the project is an Expo project.
- You start with release 1 on Shipvo. Your CodePush history stays in App Center.

## Troubleshooting

- **`Git tree is not clean (N changed path(s)). Commit or stash first, or pass --force.`** `shipvo migrate --apply` will not edit a repo with uncommitted changes. Commit or stash, then run it again. Review its edits with `git diff`.
- **The native build fails after `--apply`.** Files such as `MainApplication.kt`, `AppDelegate.mm`, `settings.gradle` and the `Podfile` still call CodePush. `--apply` lists each one with its line under the manual steps. Remove those calls by hand.
- **`shipvo migrate needs --plan ... or --apply ...`** (exit code 2). Pass one of the two flags. Passing both prints `Use --plan or --apply, not both.`
- **A `shipvo doctor` line says FAIL.** The line ends with the fix. Make it, then run `npx shipvo doctor` again.
- **Users on the old build get no update.** Ship the new store build from Step 5. Every build that includes it receives Shipvo updates.

## Next steps

- [Build your first app](getting-started.md)
- [Self-hosting the control plane](self-hosting.md)
