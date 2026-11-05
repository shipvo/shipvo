# CLI

## `shipvo init`

Two modes.

- `shipvo init <dir>` creates a new app in `<dir>`. See [Getting started](getting-started.md).
- `shipvo init` (or `shipvo init .`) inside an existing Expo or bare React Native app switches to **adopt mode**.

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

- It never overwrites a file. In an Expo app it never touches `ios/` or `android/`.
- Running it again changes nothing.
- It refuses apps that use `expo-updates` or `react-native-code-push`, because two update systems would fight over the bundle. See [Migrate from CodePush](migrate-from-codepush.md).
- A bare React Native app (committed `ios/` and `android/`, no config plugins) is handled as described below. If your app is managed, add any config plugin to `app.json`, or remove the `ios/` and `android/` folders, and run it again.

When it finishes it runs `shipvo doctor`, then tells you to rebuild the native app once and run `shipvo publish --dry-run`.

### Bare React Native apps

In a bare app, `shipvo init` uses the same plan, `--dry-run` and confirmation. The plan has these extra steps, each listed only if it is needed:

- run `npx install-expo-modules@latest`, if Expo Modules are not set up yet. It runs only after you confirm or pass `--yes`;
- add or update the `dev.shipvo.*` meta-data in `android/app/src/main/AndroidManifest.xml`;
- add or update the `Shipvo*` keys in `ios/<app>/Info.plist`.

The values are the same ones the config plugin writes. Other keys keep their order, and a second run changes nothing. It does not add a config plugin, because a bare app has no prebuild. If it cannot find the manifest or the Info.plist, it stops and changes nothing. Then it prints the next steps: `cd ios && pod install`, rebuild both apps, `shipvo publish --dry-run`.

Other options: `--control-plane <url>`. `--public-key <key>` must be base64 that decodes to 32 bytes, or it exits 2 before changing anything. If `shipvo.json` has a `publicKey` that does not match `.shipvo/seed.txt`, it stops and changes nothing. If `app.json` is not valid JSON, it stops with a one-line message. If a step fails, it lists the steps already applied.

## `shipvo preview`

Publishes a web preview of your app that anyone can open in a browser or on a phone, with no install, no account and no control plane. It uses [here.now](https://here.now).

```bash
shipvo preview          # build, publish, print the link
shipvo preview --json   # one JSON line for agents: url, claimUrl, expiresAt, files, warnings
```

What it does:

1. Builds the web app with the simulated device (`PN_SIM=1 npx expo export --platform web`) into `.shipvo/preview-build`.
2. Wraps it in a frame page (`index.html`) with a phone, iPhone-size and tablet switcher and a light and dark switch. Your app's own page is served as `app.html` inside the frame. On a phone-width screen the app fills the screen.
3. Publishes anonymously: create, upload, finalize. Expired upload URLs are refreshed. A 429 from here.now is retried after `retry_after` seconds. Warnings from here.now are printed.

**The link is public and expires in 24 hours.** Anyone with the link can open it. To keep it, open the claim link and sign in to here.now. The claim link is shown once; copy it as printed.

Safety rules:

- It never uploads `.shipvo/`, `.env*`, key files (`.pem`, `.key`, `.p8`, `.p12`, `.jks`, `.mobileprovision`), `seed.txt`, `publish-token` or source maps.
- It refuses to publish if a text file in the build holds a private key, your signing seed or publish token, or another known secret pattern. The message names the file, never the value.

Options: `--skip-build` publishes the last build in `.shipvo/preview-build`.

`shipvo.json` has a `preview` setting: `"here.now"` (default). `"control-plane"` (permanent hosting at `/w/{app}/r{release}/`) is reserved and not built yet; setting it stops with a message.

Agents can call the MCP tool `publish_preview`; it runs `shipvo preview --json` in `PN_APP_DIR` (or the current folder) and returns `{ url, claimUrl, expiresAt }`.

`shipvo init` adds `.github/workflows/preview.yml`, which publishes each pull request's web build and comments the link on the pull request. Pull requests from forks are skipped.

## `policy` in `shipvo.json`

An optional `policy` section writes release rules down. `shipvo publish --dry-run` checks them. If a rule refuses, it prints the rule and the reason and exits with code 1. The real upload is not checked yet; that comes in a later slice.

```json
{
  "appId": "habits",
  "policy": {
    "maxBand": "b1",
    "agentMaxBand": "b0",
    "blockedWeekdays": ["fri"],
    "blockedAfterHour": 12
  }
}
```

Then run:

```bash
shipvo publish --dry-run --bands b0,b1,b2
# Refused by policy rule maxBand: this publish reaches b2, but policy.maxBand is b1
```

| Field | Meaning |
| --- | --- |
| `maxBand` | Widest band any publish may reach: `b0`, `b1` or `b2`. The widest band in `--bands` counts. |
| `agentMaxBand` | Same, for a publish run by an agent. Set `SHIPVO_ACTOR=agent` in the agent's environment. Without it the publish counts as human. |
| `blockedWeekdays` | Days with no publish: `mon` to `sun`, in local time. |
| `blockedAfterHour` | Hour 0-23, local time. Publishes on `blockedWeekdays` are refused from this hour on (12 means from 12:00). Without it, the whole day is blocked. Needs `blockedWeekdays`. |

Without a `policy` section nothing is checked. A bad section (unknown field, wrong value) stops the dry run and names the field, for example `policy.maxBand`.

## `shipvo auto-halt`

Stops serving a release on its own when too many devices fail to apply it.

```bash
shipvo auto-halt                                   # print the current setting
shipvo auto-halt --threshold 0.2 --min-reports 20  # on: halt when more than 20% of at least 20 reports failed
shipvo auto-halt --off                             # off
shipvo auto-halt --threshold 0.2 --dry-run         # print the change, write nothing
```

- `--threshold` is above 0 and at most 1. `--min-reports` is a whole number from 1 to 10000 (default 20).
- It needs `SHIPVO_OWNER_TOKEN`, or the publish token from `shipvo app create` (`SHIPVO_PUBLISH_TOKEN` or `.shipvo/publish-token`). A publish token can turn auto-halt off, so a leaked CI publish token can disable it.
- `shipvo status` shows the setting: `auto-halt: off` or `auto-halt: on at 20% after 20 reports`.
- The route behind it is `GET`, `PUT` and `DELETE` on `/app/<app>/api/halt-config`. A bad value is a 400 with `error: "bad_halt_config"`.
