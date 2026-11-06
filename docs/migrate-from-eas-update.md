# Migrate from EAS Update to Shipvo

This guide takes an Expo app that uses `expo-updates` (EAS Update) from `shipvo migrate --plan` to a signed Shipvo release. `shipvo migrate --plan` (`packages/cli/src/migrate.ts`) only reads; it changes no files. You do the edits by hand.

Facts about `expo-updates` are from the [Expo EAS Update docs](https://docs.expo.dev/eas-update/introduction/). This guide makes no claim about EAS speed, price or compatibility.

## How this guide was checked

Run on 2026-11-06: the commands marked **(run)** below on a Linux runner with Node 22, against a scratch Expo SDK 54 app (`/tmp/eas-demo`) that had `expo-updates` set up the way EAS asks, and the output below is from that run. The sample app `apps/tide-and-tackle` has no `expo-updates`, so on its own it prints "Nothing to migrate". Commands marked **(not run)** need a Shipvo account, a store build or a phone, which that runner did not have.

## Why `shipvo init` stops

Two update systems in one build would fight over the bundle. `shipvo init` refuses an app with `expo-updates` and changes nothing. Remove `expo-updates` first, then run `init`.

## 1. Read the plan (run)

```bash
npx shipvo migrate --plan
```

Output for the scratch app:

```
Found expo-updates (EAS Update):
  - package.json dependencies: expo-updates@~29.0.0
  - app.json plugins: expo-updates
  - app.json: updates: {"url":"https://u.expo.dev/00000000-0000-0000-0000-000000000000"}
  - app.json: runtimeVersion: {"policy":"appVersion"}

Steps, in this order:
  1. Commit your work. Installed apps keep using EAS Update until a new store build ships, so do not stop publishing to EAS yet.
  2. Remove expo-updates from package.json (npm remove expo-updates).
  3. Remove the expo-updates entry from plugins, and the updates and runtimeVersion keys, from the app config.
  4. Remove calls to the expo-updates API (for example Updates.checkForUpdateAsync) from your code.
  5. Run shipvo init. It adds @shipvo/runtime, the config plugin, a signing key, shipvo.json, the sim/publish/rollback scripts and a publish workflow. It never overwrites a file.
  6. Back up the signing seed (shipvo keys export). If you lose it, installed apps will not accept another update.
  7. Build and submit a new store build. Only this build uses Shipvo; older binaries keep using EAS Update.
  8. Run shipvo publish --dry-run, then shipvo publish for the first Shipvo release once the new build is on devices.

No files were changed. Details: docs/migrate-from-eas-update.md
```

`--json` prints the same plan for scripts and agents. With `app.config.js` or `app.config.ts` it cannot read the config, and tells you to check those entries by hand. With neither `expo-updates` nor CodePush it exits 0 and says there is nothing to migrate.

## 2. What maps to what

| EAS Update | Shipvo | Notes |
| --- | --- | --- |
| `eas update` | `shipvo publish` | Builds the bundle, signs it, publishes it. |
| Channels and branches | Cohort bands: `--bands b0,b1,b2` | A release goes to bands, in order: b0 is 1% of devices, b1 is 10%, b2 is 100%. You cannot pick another percent. `shipvo promote --to b1,b2` widens it. Bands are not named channels. |
| `runtimeVersion` | The shell: `shellMajor` in the `@shipvo/runtime` plugin props, the Hermes bytecode version, and the native modules the build contains | A release is only offered to a shell it fits. See below. |
| Code signing certificate | Ed25519 key made by `shipvo init` | Signing is always on. The public key is pinned in the shell. |
| `eas update:rollback` | `shipvo rollback --to <release>` | Republishes an earlier release as a new release number. |

**Runtime version.** EAS pairs an update with a build by a `runtimeVersion` string you choose. Shipvo checks facts instead. The shell declares its `shellMajor` and Hermes bytecode version, and `publish` lists the native modules the release needs (the dry run prints them). A mismatched release is refused on the device and by the control plane. The rules are in [adapters.md](adapters.md), rules 2 (major), 6 (bytecode) and 7 (native modules).

**Signing.** `shipvo init` creates the key and writes the seed to `.shipvo/seed.txt` (git-ignored). If you lose the seed, installed apps will not accept another update. See [new-machine.md](new-machine.md).

## 3. From `init` to first publish

1. Commit your work. Keep publishing to EAS Update for now.
2. Remove `expo-updates` with your package manager, remove its plugin entry and the `updates` and `runtimeVersion` keys from the app config, and remove calls to its API. **(run)** On the scratch app, after editing the files, `migrate --plan` reported "Nothing to migrate".
3. Preview what `init` will do. **(run)**

   ```bash
   npx shipvo init --dry-run --app-id myshop
   ```

   It lists eight steps (install `@shipvo/runtime`, install `@shipvo/cli` and `@shipvo/sim` as dev dependencies, ignore `.shipvo/`, create the key, add the plugin to `app.json`, write `shipvo.json`, add scripts, add a publish workflow), says it will not touch `ios/` or `android/`, and changes nothing.

4. Apply it. **(run)**

   ```bash
   npx shipvo init --yes --app-id myshop
   ```

   Without a terminal, `init` asks for `--yes` or `--dry-run`. It ran `doctor` at the end and every line was PASS. It changed `app.json`, `package.json` and `.gitignore`, and added `shipvo.json`, `.github/workflows/publish.yml` and `.shipvo/seed.txt`. The plugin entry in `app.json` holds `baseUrl`, `publicKey`, `appId` and `shellMajor`.

5. Back up the seed. **(run)**

   ```bash
   npx shipvo keys export --out seed.txt
   ```

   It writes the seed and prints the public key. Put the seed in a password manager, then delete the file.

6. Check a release offline. **(run; it failed on the scratch app, see below)**

   The dry run builds the Android and the web export. The web export needs `react-dom` and `react-native-web`. The scratch app did not have them, so the dry run failed at that step. If your app has no web build, remove `web` from `platforms` in the app config first, or install those two packages. Then run:

   ```bash
   npx shipvo publish --dry-run --out .shipvo/dry-run
   ```

   Output on the scratch app, before the failure: `native modules this release requires: @shipvo/runtime@^0.1.4, expo@~54.0.0, react-native@0.81.0`. It exported the Android Hermes bundle (`.hbc`) and said `patches: none`. A dry run builds no patches. The run after the `platforms` change was not repeated, so this guide does not show a passing dry run.

7. Sign in and create the app on the hosted control plane. **(not run)**

   ```bash
   npx shipvo login
   npx shipvo app create
   ```

   `shipvo login` opens a GitHub device-code page and waits for you. The runner could not complete it. To host it yourself, see [self-hosting.md](self-hosting.md).

8. Build and submit a new store build. **(not run)** Only this build contains the Shipvo runtime. Older binaries keep using EAS Update. Build with `npx expo prebuild`, then `npx expo run:android` or `npx expo run:ios`, or your usual store build.

9. Publish. **(not run)**

   ```bash
   npx shipvo publish
   ```

   The default is `--bands b0,b1,b2`. To go slowly, start with `--bands b0` and widen with `shipvo promote --to b1,b2`.

## 4. First applied update

Once the new build is on a device, change something visible, run `shipvo publish`, and open the app. The runtime downloads the release, checks the signature, and applies it on the next start. `Runtime.markHealthy()` tells the runtime the first screen rendered; after three failed boots it goes back to the last good bundle. The `App.tsx` that `shipvo init <dir>` writes shows the calls. `scripts/first-run/applied-ota.mjs` times this on an Android emulator; read [getting-started.md](getting-started.md#5-publish-over-the-air) for the measured steps.

This guide did not apply an update on a device. Steps 7 to 9 and this section are written from the CLI help and the getting-started guide, not from a run.

## 5. What does not map yet

- **Percentage rollouts.** Shipvo releases to three bands: b0 reaches 1% of devices, b1 reaches 10% and b2 reaches 100%. You cannot pick an arbitrary percent such as 20%. Policy rules (`maxCohortForAgents`, `requireStageBeforeFull`) can take a percent as a limit, but a release itself still goes to a band.
- **Named channels.** There is no channel or branch you point builds at. Bands are cohorts of installs, set by `--bands`.
- **A dashboard.** Shipvo has `shipvo status` and a per-app admin page, but nothing that matches the EAS Update dashboard feature for feature.
- **Automatic edits.** `shipvo migrate` only plans. It does not remove `expo-updates` or edit your config.
- **A smooth in-place switch.** Binaries already on phones stay on EAS Update until users install a build that has the Shipvo runtime.
- **Code config files.** `app.config.js` and `app.config.ts` are not read by the plan.

See also [Migrate from CodePush](migrate-from-codepush.md) and [cli.md](cli.md).
