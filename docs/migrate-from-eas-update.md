# Migrate from EAS Update to Shipvo

This guide moves an Expo app that uses `expo-updates` (EAS Update) to Shipvo over-the-air updates. `shipvo migrate --plan` (`packages/cli/src/migrate.ts`) prints the plan for your app. It only reads; it changes no files. `shipvo migrate --apply` makes the safe edits for you (see below). You do the other steps by hand.

Facts about `expo-updates` are from the [Expo EAS Update docs](https://docs.expo.dev/eas-update/introduction/).

## Why `shipvo init` stops

Two update systems in one build would fight over the bundle. `shipvo init` refuses an app with `expo-updates` and changes nothing. Remove `expo-updates` first, then run `init`.

## See the plan

```bash
npx shipvo migrate --plan
npx shipvo migrate --plan --json
```

Real output, from a copy of `apps/tide-and-tackle` with `expo-updates`, an `updates` key and a `runtimeVersion` key added (the sample app itself has none, so on the unchanged app it prints "Nothing to migrate"):

```text
Found expo-updates (EAS Update):
  - package.json dependencies: expo-updates@~58.0.0
  - app.json plugins: expo-updates
  - app.json: updates: {"url":"https://u.expo.dev/x"}
  - app.json: runtimeVersion: {"policy":"appVersion"}

Steps, in this order:
  1. Commit your work. ...
  (8 steps, the same as "Order of steps" below)

No files were changed.
```

It lists each entry it found:

- `expo-updates` in `dependencies` or `devDependencies` of `package.json`
- `expo-updates` in `plugins` of `app.json`
- the `updates` and `runtimeVersion` keys (also `ios.runtimeVersion` and `android.runtimeVersion`) in `app.json`

With `app.config.js` or `app.config.ts` it cannot read the config. It tells you to check those entries by hand.

In an app with neither `expo-updates` nor CodePush it exits 0 and says there is nothing to migrate.

## Apply the safe edits

```bash
npx shipvo migrate --apply
npx shipvo migrate --apply --json
```

`--apply` removes exactly the entries `--plan` lists, and nothing else: the `expo-updates` dependency, the `expo-updates` plugin entry, and the `updates` and `runtimeVersion` keys in `app.json`. Before it writes, it copies each changed file to `.shipvo/migrate-backup/`.

- It refuses a dirty git tree. Commit or stash first, or pass `--force`.
- It does not edit `app.config.js` or `app.config.ts`, your code, or the lockfile. Run your package manager's install afterwards.
- It does not run `shipvo init`. It prints that as the next step.
- A second run exits 0 and says there is nothing left to do.

## Order of steps

1. Commit your work. Keep publishing to EAS Update for now. Binaries already on phones keep using EAS Update until a new store build ships.
2. Remove `expo-updates` from `package.json` with your package manager.
3. Remove the `expo-updates` plugin entry and the `updates` and `runtimeVersion` keys from the app config.
4. Remove calls to the `expo-updates` API from your code.
5. Run `shipvo init`. It adds `@shipvo/runtime`, the config plugin, a signing key, `shipvo.json`, scripts and a publish workflow. It never overwrites a file.
6. Back up the signing seed with `shipvo keys export`. If you lose it, installed apps will not accept another update. See [new-machine.md](new-machine.md).
7. Build and submit a new store build. Only this build uses Shipvo.
8. Run `shipvo publish --dry-run`, then `shipvo publish`.

## What maps to what

| EAS Update | Shipvo |
| --- | --- |
| `eas update` | `shipvo publish` |
| Channels and branches | Cohorts (bands): `--bands b0,b1,b2` |
| `eas update:rollback` | `shipvo rollback --to <release>` |
| `runtimeVersion` | `shellMajor` in `shipvo.json`. The shell also declares its Hermes bytecode version and native modules; `shipvo publish` checks a release against them |
| Code signing certificate | Ed25519 key made by `shipvo init` |

## First publish and first applied OTA

After `shipvo migrate --apply` and `shipvo init --yes` on that copy, `init` printed all `doctor` checks as PASS and the next steps: rebuild the native app once (`npx expo prebuild`, then `npx expo run:android`), then `npx shipvo publish --dry-run`.

Not yet run for this guide: `shipvo publish --dry-run` (it needs `npm install` and a native platform in the app) and the first applied OTA on the Android emulator. This runner has no emulator. The script that times it is `scripts/first-run/applied-ota.mjs`. Until a CI run is linked here, this guide does not claim an applied OTA.

## What does not map yet

- Percentage rollouts: Shipvo has cohort bands (`--bands`), not an arbitrary percentage.
- A dashboard: there is no web dashboard for releases. Use the CLI.
- Channels and branches as separate objects: bands are the only grouping.

See also [Migrate from CodePush](migrate-from-codepush.md) and [cli.md](cli.md).
