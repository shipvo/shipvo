# CLI

## `shipvo init`

Two modes.

- `shipvo init <dir>` creates a new app in `<dir>`. See [Getting started](getting-started.md).
- `shipvo init` (or `shipvo init .`) inside an existing Expo app switches to **adopt mode**.

### Adopt mode

Run it in the app's root. The folder needs a `package.json` with `expo` and an `app.json` or `app.config.js/ts`.

```bash
npx -y @shipvo/cli init --dry-run   # print the plan, change nothing
npx -y @shipvo/cli init             # print the plan, then ask
npx -y @shipvo/cli init --yes       # apply without asking
```

It detects the Expo SDK version, the package manager (from the lockfile: npm, pnpm, yarn or bun), the config kind, and whether `expo-updates` or CodePush is present. Then it plans:

- install `@shipvo/runtime` (and `@shipvo/device` with `--device`) with your package manager, and `@shipvo/cli` and `@shipvo/sim` as dev dependencies, so `shipvo` in your scripts and CI is ours and not another npm package;
- add the `@shipvo/runtime` config plugin to `app.json`, with a new signing key in `.shipvo/seed.txt` (git-ignored), or the key you pass with `--public-key`;
- write `shipvo.json` (the app id comes from the slug), and add `sim`, `publish` and `rollback` scripts;
- add `.shipvo/` to `.gitignore`;
- add `.github/workflows/publish.yml` only if it does not exist. It runs by hand only (`workflow_dispatch`) and skips pushes whose commit message has `[no-ota]`. It does not publish on every push to `main`, so nothing ships to phones by surprise. Add a `push` trigger with a `paths` filter when you want that.

With `app.config.js` or `app.config.ts` it does not rewrite your code. It prints the exact lines to add to `plugins`.

Rules it keeps:

- It never overwrites a file and never touches `ios/` or `android/`.
- Running it again changes nothing.
- It refuses apps that use `expo-updates` or `react-native-code-push`, because two update systems would fight over the bundle. See [Migrate from CodePush](migrate-from-codepush.md).
- Bare React Native apps (committed `ios/` and `android/`, no config plugins) are not supported yet. It says so and changes nothing. If your app is managed, add any config plugin to `app.json`, or remove the `ios/` and `android/` folders, and run it again.

When it finishes it runs `shipvo doctor`, then tells you to rebuild the native app once and run `shipvo publish --dry-run`.

Other options: `--control-plane <url>`. `--public-key <key>` must be base64 that decodes to 32 bytes, or it exits 2 before changing anything. If `shipvo.json` has a `publicKey` that does not match `.shipvo/seed.txt`, it stops and changes nothing. If `app.json` is not valid JSON, it stops with a one-line message. If a step fails, it lists the steps already applied.
