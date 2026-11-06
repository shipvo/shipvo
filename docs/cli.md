# CLI

This guide is for developers who use the `shipvo` command. It lists each command with an example and the output to expect, and ends with fixes for errors people have hit. If you are new to the terminal, start with [Create your first app](tutorials/first-app.md) instead.

Run `npx -y @shipvo/cli --help` to see the commands your installed version has.

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

Testers can tap **Comment** (a button that stays visible on phones), tap a point in the app and type a note. Each note stores the text, the point, the screen and the steps taken so far. Notes show in a side list, stay in the browser (localStorage) until exported, and **Export comments.json** downloads them. Nothing is uploaded. The point is measured from the top left of the whole device box, status bar included. Steps are kept in memory, so notes saved after a reload start with an empty step list.

Agents can call the MCP tool `publish_preview`; it runs `shipvo preview --json` in `PN_APP_DIR` (or the current folder) and returns `{ url, claimUrl, expiresAt }`.

`shipvo init` adds `.github/workflows/preview.yml`, which publishes each pull request's web build and comments the link on the pull request. Pull requests from forks are skipped.

### Device panel

The preview page has a **Device** panel beside the phone (under it at phone width). It sets the same simulated device state as the MCP `set_device` and `push_notification` tools. Every event is simulated.

- **Location**: pick a place, or type latitude and longitude.
- **Camera**: put an EAN-13 or QR code in front of the camera, or nothing. Images are left for later.
- **Fingerprint / Face ID**: matches or does not match every check until you change it.
- **Payment**: every payment is approved or declined until you change it.
- **Network**: online, slow (the app's `fetch` calls wait 1.5 s) or offline.
- **Push notification**: send a title and body; it shows as a banner. Nothing is delivered if the app has not been granted notification permission, and the panel says so.

## `policy` in `shipvo.json`

An optional `policy` section writes release rules down. `shipvo publish --dry-run` checks them. If a rule refuses, it prints the rule and the reason and exits with code 1. The control plane checks the same rules on the real publish, including `shipvo promote`. It refuses with 403 `policy_refused`, the rule and the reason, and writes one audit row.

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

To check the policy without building anything, use `--dry-run-policy`. It reads `shipvo.json`, checks the bands in `--bands` (default all three), prints the result and publishes nothing. It exits 0 when the policy allows the publish or there is no policy, and 1 when a rule refuses.

```bash
shipvo publish --dry-run-policy --bands b0,b1,b2
```

| Field | Meaning |
| --- | --- |
| `maxBand` | Widest band any publish may reach: `b0`, `b1` or `b2`. The widest band in `--bands` counts. |
| `agentMaxBand` | Same, for a publish run by an agent. Set `SHIPVO_ACTOR=agent` in the agent's environment. Without it the publish counts as human. |
| `blockedWeekdays` | Days with no publish: `mon` to `sun`, in the policy's time zone (see `timeZone`). |
| `timeZone` | IANA name such as `Europe/Paris`. Sets the zone for `blockedWeekdays` and `blockedAfterHour`. Without it the CLI uses the machine's local time and the control plane uses UTC. |
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

## `shipvo agents setup`

Sets a project up for AI coding agents.

```bash
shipvo agents setup              # write the files
shipvo agents setup --dry-run    # show what would change, write nothing
shipvo agents setup --json       # machine-readable result
```

- It detects the project: Shipvo app (`shipvo.json`), Capacitor, Expo, bare React Native.
- It writes a section to `AGENTS.md` between `<!-- shipvo:begin -->` and `<!-- shipvo:end -->`. A missing file is created. Text outside the markers is never changed.
- It adds the `shipvo` server (`npx -y @shipvo/mcp`) to `.mcp.json`, and to `.cursor/mcp.json` if `.cursor/` exists. Other servers stay. A file that is not valid JSON is left alone and the command exits 2.
- It prints the skill install line.
- Running it again changes nothing.

## `shipvo status --json`

The agent's "what next" command. It prints one JSON line:

```json
{ "ok": true, "code": "ok", "summary": "...",
  "data": { "project": {}, "sim": {}, "run_server": {}, "signing_key": {}, "pending_release": {}, "store_step": {} },
  "next": [{ "command": "shipvo sim", "why": "..." }] }
```

- `data.project`: `{ kind, app_id }`. `sim`: is something on port 4545. `run_server`: is `shipvo run` up (from `.shipvo/run.json`). `signing_key.present`: a seed in the environment or `.shipvo/seed.txt`. `pending_release`: `{ newest, halted, auto_halt }`. `store_step`: the next open step of `store-plan.json`, or `null`.
- `code` is one of `ok`, `no_release`, `no_project`, `no_signing_key`, `release_halted`, `error`.
- `next` lists commands to run, most urgent first.
- Without `--json` the output is the same table as before.

| Exit code | Meaning |
| --- | --- |
| 0 | ok: nothing needs doing (`next` may still have optional steps) |
| 1 | action needed: no project, no signing key, or a halted release |
| 2 | error: shipvo.json is invalid or the control plane could not be reached |

## `shipvo smoke`

One fast answer: does the app still load? It starts the simulator like `shipvo explore` does, opens the app headless and waits for the first screen to settle (the tree is the same twice in a row).

```bash
shipvo smoke              # android (default)
shipvo smoke ios --json --timeout 60
```

It fails when the page throws, logs `console.error`, has an unhandled rejection, or the first screen has no elements. `--timeout <s>` defaults to 30. If the first screen is still changing when the timeout ends, that is a failure too. Failed resource loads (such as a missing favicon) are not counted. It does not take screenshots or tap anything; use `shipvo explore` for that.

`android` and `ios` only change the `platform` label in the result. Both run the same simulator skin.

`--json` prints one line on stdout, the same envelope as `status --json`:

```json
{ "ok": false, "code": "load_failed", "summary": "...",
  "data": { "platform": "android", "time_to_first_screen_ms": 820, "elements": 0, "errors": ["Uncaught error: boom"], "error_count": 1 },
  "next": [{ "command": "shipvo sim", "why": "..." }] }
```

- With `--json`, the app build output goes to stderr so stdout stays one line.
- `code` is `ok`, `load_failed` or `setup_error`. `data.errors` holds the first 5 errors; `error_count` is the total.
- A missing browser or Playwright is a setup error. `next` then has the install command.

| Exit code | Meaning |
| --- | --- |
| 0 | the app loaded with no errors |
| 1 | load failed: an error, or an empty first screen |
| 2 | setup error: no `shipvo.json`, browser missing, build or simulator failed, bad arguments |

## `--json` for `doctor`, `test` and `explore`

`shipvo doctor --json`, `shipvo test --json` and `shipvo explore --json` print the same envelope as `status --json`: `{ ok, code, summary, data, next }`. Stdout holds only that one JSON line. Progress and logs go to stderr, including the Playwright install notice for `explore` and the progress lines of `test`. The text output is unchanged without `--json`.

| Command | `code` values | `data` |
| --- | --- | --- |
| `doctor` | `ok`, `checks_failed`, `usage` | `checks`: `[{ name, ok, fix, note }]` |
| `test` | `ok`, `tests_failed`, `usage`, `error` | `flows`, `failed`, `repaired`, `unresolved` |
| `explore` | `ok`, `findings`, `walk_failed`, `error` | `findings`, `steps`, `screens`, `report_files`, `stopped_early` |

`next` has one to three commands. A failed doctor check adds one entry that names the fix.

| Exit code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | the check or test failed (`explore` exits 1 on findings only with `--fail-on-findings`, and always when the walk fails) |
| 2 | usage or setup error |

## `shipvo audit`

Exports an app's audit log, newest first, to stdout. Hand the file to an auditor.

```bash
shipvo audit shop > audit.json                 # JSON (default)
shipvo audit shop --format csv > audit.csv     # CSV
shipvo audit shop --limit 100                  # only the newest 100 entries
```

- It pages through `GET /audit/<app>` with `?before=<id>`, 200 rows at a time. `--limit` caps the total (default: all).
- CSV has a header row, every field in double quotes, and columns in this order: `id`, `app_id`, `at`, `actor`, `actor_kind`, `action`, `release`, `release_id`, `before`, `after`. Objects are written as JSON text.
- A value that starts with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet does not run it as a formula.
- It needs `SHIPVO_OWNER_TOKEN`, or the publish token from `shipvo app create`. A non-2xx answer prints the status and exits 1. The token is never printed.

## shipvo run

`shipvo run android` or `shipvo run ios` builds the web export with the simulated device (the same build as `shipvo sim`), serves it on a local port and opens your default browser at a phone frame page. It does not use Playwright.

- Android frame: 412x915, status bar, punch-hole camera, gesture bar. A "Show Android system sheet" button (or a `postMessage` of `{ type: "shipvo:system-sheet" }` from the app, `open: false` to close) opens an overlay with Android permission wording.
- iOS frame: 393x852, Dynamic Island, home indicator. A "Show iOS system sheet" button or the same `postMessage` opens an overlay with iOS permission wording.
- Reloading on a client-side route under `/app/` (no file extension) serves the app shell.
- The page shows a "Simulated" label and scales the phone to fit the window.
- `--no-open` prints the URL and does not open a browser. `--port <n>` picks the port (default: any free port).
- `--native` runs `npx expo run:android` or `npx expo run:ios` instead and says so.
- If the app cannot build for web, the command exits with code 1 and names the module or file that failed.
- Ctrl+C stops the server.

## `shipvo promote`

Widens a staged release to more bands. It reads a test report and refuses to widen a release whose flows failed.

```bash
shipvo test flows/ --release 3 --report shipvo-test-report.json
shipvo promote                         # reads shipvo-test-report.json if it exists
shipvo promote --report out/report.json
shipvo promote --force                 # promote anyway; prints that it overrode a failing report
```

- A report whose `release` matches the release being promoted and has any failed flow stops promote with a non-zero exit. The message lists the failing flows. `--dry-run` stops the same way.
- A report for a different release is stale. Promote prints a warning and goes on.
- With no report file, promote behaves as before.

## First run of the simulator

`shipvo sim`, `shipvo explore`, `shipvo test` and `shipvo store screenshots` check the browser setup before they start:

1. If `playwright` is not installed, the CLI installs it as a dev dependency with your package manager (pnpm, yarn, bun or npm, chosen from the lockfile).
2. The simulator uses system Chrome or Edge when it finds one. Otherwise it uses Playwright's Chromium, and downloads it once with `npx playwright install chromium` if it is missing.

`shipvo doctor` shows which browser it found. With no Chrome, Edge or Chromium it still passes, and notes that the first run downloads Chromium once.

Set `SHIPVO_NO_AUTO_INSTALL=1` to turn both installs off. The command then stops and prints what to run yourself, and `shipvo doctor` fails the browser check when nothing is installed.

## Troubleshooting

These come from fixed issues in this repository.

**`Executable doesn't exist` when you run `shipvo sim` or `shipvo doctor`.** The simulator's browser is not installed. Run `npx playwright install chromium` in the app folder. On Linux, add the system packages the message names.

**`ERR_PNPM_NO_MATCHING_VERSION` for `playwright` after `shipvo init`.** Apps made by an old CLI had a Playwright range that the registry could not satisfy. Update the CLI. New apps pin `playwright` to `>=1.63.0 <1.65.0`.

**`shipvo publish` fails with `ECONNRESET` or a similar network error.** The CLI shows the real error and the key it was writing, and retries network failures twice. If it still fails, check your connection and the control plane address. HTTP errors such as 401 are not retried: check your token.

**`shipvo publish` says `Refused by policy rule ...` (also on `--dry-run`).** Your `policy` section in `shipvo.json` forbids this publish. Change the cohort bands you publish to, or change the rule. Use `--dry-run-policy` to test the rule without building.

**`shipvo audit` exits 1 with a status code.** The token is missing or wrong. Set `SHIPVO_OWNER_TOKEN`, or use the publish token from `shipvo app create`.

**`shipvo sim --watch` prints one line about a broken JSON file.** Fix the comma or quote it names and save. Add `--verbose` for the full build error.

## Next steps

- [Test your app in CI](testing.md), including `shipvo test --repair` and `--report`.
- [Store details and screenshots](store.md).
- [Self-host the control plane](self-hosting.md).
- [Glossary](glossary.md) for the words used here.
