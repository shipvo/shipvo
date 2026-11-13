# Test any Expo app on Shipvo Phone from the terminal

This page is for you if you have an Expo app and a coding agent that can run shell commands. You will open the app on a headless Shipvo Phone, on Android and iOS, tap through it, save screenshots and a video of the phone in its frame, and stop the session. You do not need an emulator, Xcode, a cloud account or `shipvo init`.

## What you need

- An Expo app (a folder whose `package.json` lists `expo`).
- Node 22.
- The web packages Expo builds with: `react-native-web`, `react-dom` and, from Expo 49, `@expo/metro-runtime`. A package another dependency already installs counts. If one is missing, `session start` names it and prints the command that adds it.

## Start a session

1. Open a terminal in the app folder.
2. Run:

   ```bash
   npx -y @shipvo/cli session start ios --max-duration-minutes 20 --json
   ```

   Use `android` for an Android phone. Leave the platform out and you get Android.
3. Shipvo builds the app for web, opens it on the phone and prints one JSON document. `data.screen` is the first screen as a tree. Each element you can act on has a ref such as `e6`:

   ```text
   - heading "Counter demo" [level=1] [ref=e4]
   - generic [ref=e5]: "Count: 0"
   - button "Add one" [ref=e6] [cursor=pointer]
   - textbox "Your name" [ref=e8]
   ```

## Apps with a router

`session start` sees `expo-router` or `@react-navigation/native` in your `package.json` and opens the app at its own root route, so the first screen is your index route. Moving between screens, a phone restart on a deep screen such as `/feed/1`, and a reload all stay inside the app.

## What the phone does for a real app

- **A build with a base path.** An app built with Expo's `experiments.baseUrl` (for example `/static`) gets its files under that path.
- **An app that keeps the network busy.** The session opens once the app has loaded. It waits up to 5 seconds more for the network to go quiet, so an app that polls or streams still opens. `SHIPVO_SIM_NET_QUIET_MS` changes that wait.
- **Sound.** The app may play sound without a tap first, as on a phone.
- **Only this machine.** The session's simulator listens on `127.0.0.1`, so other machines on your network cannot reach it.
- **A script that does not load.** It is recorded with the app's other errors, so a blank screen comes with its cause.

## Pick a phone model

A session is a real phone model, with that phone's screen size, pixel ratio and user agent. `session start android` is a Pixel 8 and `session start ios` is an iPhone 16. Name another one with `--device`:

```bash
shipvo session start --device "iPhone 16 Pro"
shipvo session start --device "Galaxy S24"
shipvo session devices          # every model, with its platform and screen size
```

The model decides the platform, so `android` or `ios` can be left out. The app gets the phone's screen without the status bar and the bottom bar, as an app does on that phone, and `data.device` in the result names the model. Screenshots and recordings show the frame at that phone's proportions, with the status bar icons in the platform's order.

| Model | Platform | Screen (CSS pixels) | Pixel ratio |
| --- | --- | --- | --- |
| Pixel 7, Pixel 8 | Android | 412x915 | 2.625 |
| Pixel 8 Pro, Pixel 9 Pro XL | Android | 448x997 | 3 |
| Pixel 9 | Android | 360x808 | 3 |
| Pixel 9 Pro | Android | 427x952 | 3 |
| Galaxy S24 | Android | 360x780 | 3 |
| Galaxy A55 | Android | 480x1040 | 2.25 |
| iPhone 15, iPhone 16 | iOS | 393x852 | 3 |
| iPhone 15 Pro Max | iOS | 430x932 | 3 |
| iPhone 16 Pro, iPhone 17 | iOS | 402x874 | 3 |
| iPhone 16 Pro Max, iPhone 17 Pro Max | iOS | 440x956 | 3 |

The session stops on its own at `data.expires_at`. `--max-duration-minutes` sets that time (default 30, at most 1440).

## Drive the phone

Each command acts on the newest running session in the folder. Pass `--id <id>` to name one.

```bash
shipvo session screen                       # read the screen
shipvo session tap e6                       # tap an element
shipvo session type e8 "Hans"               # type into a field
shipvo session scroll down                  # or up, left, right; add a ref to scroll inside an element
shipvo session back                         # the app's Back button
shipvo session screenshot --out shots/home.png
shipvo session errors                       # what the app threw, and scripts that did not load
```

`tap`, `type`, `scroll` and `back` print the new screen. `type` also returns the value the field holds.

## Screenshots show the whole phone

`session screenshot` saves the phone as you would see it: the app inside its Android or iPhone frame, with the status bar (clock, signal, Wi-Fi, battery), the camera cutout or Dynamic Island, and the gesture bar or home indicator. The app's pixels are placed in the frame at their real size. The picture is a PNG with a transparent background.

| | Android | iOS |
| --- | --- | --- |
| App area (Pixel 8, iPhone 16) | 412x855 | 393x764 |
| Top | Status bar with punch-hole camera | Status bar with Dynamic Island |
| Bottom | Gesture bar | Home indicator |

The status bar follows the phone: it shows the phone's clock, and airplane mode or Wi-Fi off change its icons. The status bar and the bottom bar take the colour of your app's screen next to them, with light marks on a dark screen, as when an app draws behind them on a phone. Add `--no-frame` to save the app area alone.

## Record a video

```bash
shipvo session record start
shipvo session tap e6
shipvo session type e8 "Hans"
shipvo session record stop --out videos/checkout.mp4
```

`record start` begins recording the phone in its frame. `record stop` saves an MP4 and prints its path, `duration_s` and `frames`. Without `--out` the video stays in the session folder, and `session get` lists it under `artifacts` next to the screenshots, so a person can review what the agent did later. A recording that is still running when the session stops, or when it reaches its time limit, is saved first. Recording needs `ffmpeg` on the PATH.

## See, list and stop sessions

```bash
shipvo session get        # status, address, expiry and the screenshots taken
shipvo session list       # every session started in this folder
shipvo session stop       # end it now; safe to run twice
shipvo session clean      # remove stopped sessions and their files
```

`shipvo session clean` removes the folders of stopped sessions, with their screenshots and videos. Running sessions are left alone.

`get` returns `status` (`in_progress` or `stopped`), and for a stopped session `stop_reason`: `stopped` (you stopped it), `expired` (it reached its time limit) or `exited`. `artifacts` lists each screenshot and video with its path. Session files live in `.shipvo/sessions/`, which Shipvo adds to `.gitignore`.

## Watch it, or drive it over MCP

- `data.watch_url` shows the phone live in your browser in its Android or iOS frame, with each step the agent takes.
- `data.mcp_env` holds `PN_SIM`. Start `@shipvo/mcp` with it and the MCP tools (`open_app`, `screen`, `tap`, `set_device`, `record_start` and the rest) drive the same simulator. See [Agents and MCP tools](agents.md).

## A prompt for your agent

```text
Run `npx -y @shipvo/cli session start android --max-duration-minutes 20 --json` in my app folder.
Run `shipvo session record start`. Follow `next` in each result. Tap through the main screens and save
a screenshot of each with `shipvo session screenshot --out shots/<name>.png`. Then run
`shipvo session record stop --out videos/android.mp4`, tell me what broke, and run `shipvo session stop`.
Repeat with `ios`.
```

## JSON output

With `--json` every command prints `{ ok, code, summary, data, next }` on stdout. Exit 0 ok, 1 failed, 2 usage or setup error. `next` holds the commands to run next.

`session start` data:

| Field | Meaning |
| --- | --- |
| `id` | The session id, for `--id`. |
| `platform` | `android` or `ios`. |
| `device` | The phone model, for example `iPhone 16`. |
| `status` | `in_progress`. |
| `url`, `watch_url` | The simulator's address and the live view. |
| `started_at`, `expires_at` | When it started and when it stops on its own. |
| `screen` | The first screen. |
| `mcp_env` | The environment for `@shipvo/mcp`. |

## Troubleshooting

| Code | Meaning | What to do |
| --- | --- | --- |
| `not_expo` | `package.json` has no `expo` dependency. | Run the command in your Expo app's folder. |
| `web_deps_missing` | A web package is missing. | Run the command in `next`, then start again. |
| `build_failed` | The web build failed. The summary names the cause: the module or file, the Node version the app needs, or the `"web": { "bundler": "metro" }` setting an older app has to add. | Do what the summary says, then start again. |
| `no_browser` | No Chromium was found and it could not be installed. | Run `shipvo doctor`. |
| `no_session` | No running session, or the id is unknown. | Run `shipvo session list`, or start one. |
| `session_stopped` | The session ended. | Start a new one. |
| `bad_model` | The `--device` name is not a model Shipvo knows, or it is not a phone of the platform you named. | Run `shipvo session devices` and use a name from it. |
| `no_ffmpeg` | `record stop` did not find ffmpeg. | Install ffmpeg, then record again. |
| `recording_active` | `record start` was called while a recording runs. | Run `shipvo session record stop` first. |
| `no_recording` | `record stop` was called with no recording running. | Run `shipvo session record start` first. |
| `stale_ref` | The ref is not on the screen now. | Run `shipvo session screen` and use a ref from it. |

## Next steps

- [Run your app on a phone in your browser](run.md)
- [Agents and MCP tools](agents.md)
- [Simulator vs device parity](parity-results.md)
