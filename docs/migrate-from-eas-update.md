# Migrate from EAS Update to Shipvo

This page is for developers with an Expo app on EAS Update. You will get a plan for your app, the safe edits applied with backups, and the order of the remaining steps.

This guide moves an Expo app that uses `expo-updates` (EAS Update) to Shipvo over-the-air updates. `shipvo migrate --plan` (`packages/cli/src/migrate.ts`) prints the plan for your app. It only reads; it changes no files. `shipvo migrate --apply` makes the safe edits for you (see below). You do the other steps by hand.

Facts about `expo-updates` are from the [Expo EAS Update docs](https://docs.expo.dev/eas-update/introduction/).

## Why `shipvo init` stops

Two update systems in one build would fight over the bundle. `shipvo init` refuses an app with `expo-updates` and changes nothing. Remove `expo-updates` first, then run `init`.

## See the plan

```bash
npx shipvo migrate --plan
npx shipvo migrate --plan --json
```

Output as printed (not edited), from a copy of `apps/tide-and-tackle` with `expo-updates`, an `updates` key and a `runtimeVersion` key added (the sample app itself has none, so on the unchanged app it prints "Nothing to migrate"):

```text
Found expo-updates (EAS Update):
  - package.json dependencies: expo-updates@~58.0.0
  - app.json plugins: expo-updates
  - app.json: updates: {"url":"https://u.expo.dev/x"}
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

## How the rest maps

- Percentage rollouts: use cohort bands (`--bands`) to stage a release.
- Release status: `shipvo status`, and the control plane admin at `/app/<id>/admin` for content, orders and the owner API (see [getting-started.md](getting-started.md)).
- Channels and branches: group devices with bands.

## Troubleshooting

- **`shipvo init` refuses to run**: `expo-updates` is still in the app. Run `shipvo migrate --plan` and remove every entry it lists.
- **`migrate --apply` says the git tree is not clean** (`dirty_tree`): commit or stash your work and run it again. `--force` applies anyway. Backups are in `.shipvo/migrate-backup/`.
- **The plan says to check the config by hand**: your app uses `app.config.js` or `app.config.ts`, which `migrate` does not read or edit. Remove the `expo-updates` plugin, `updates` and `runtimeVersion` there yourself.
- **`shipvo migrate needs --plan ... or --apply`**: no mode flag. Add `--plan` or `--apply`, one at a time.
- **Lockfile still lists `expo-updates`**: `--apply` does not touch the lockfile. Run your package manager's install.
- **Phones still get EAS updates**: installed apps keep the old update system until a new store build ships. That is expected. Only the new build uses Shipvo.

## Next steps

- [Getting started](getting-started.md): what `shipvo init` and `shipvo publish` do.
- [New machine and key backup](new-machine.md): back up the signing seed now.
- [Key rotation](key-rotation.md): change the signing key later without a store build.
- [Migrate from CodePush](migrate-from-codepush.md) and [CLI guide](cli.md).
