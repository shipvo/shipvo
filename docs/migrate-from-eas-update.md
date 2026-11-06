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
| `runtimeVersion` | `shellMajor` in the `@shipvo/runtime` plugin props |
| Code signing certificate | Ed25519 key made by `shipvo init` |

See also [Migrate from CodePush](migrate-from-codepush.md) and [cli.md](cli.md).
