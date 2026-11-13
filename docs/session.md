# Test any Expo app on Shipvo Phone from the terminal

This page is for you if you have an Expo app and a coding agent that can run shell commands. You will open the app on a headless Shipvo Phone, on Android and iOS, tap through it, save screenshots and a video of the phone in its frame, and stop the session. You do not need an emulator, Xcode, a cloud account or `shipvo init`.

## What you need

- An Expo app (a folder whose `package.json` lists `expo`).
- Node 22.
- The web packages Expo builds with: `react-native-web`, `react-dom` and `@expo/metro-runtime`. If one is missing, `session start` names it and prints the command that adds it.

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
```

`tap`, `type`, `scroll` and `back` print the new screen. `type` also returns the value the field holds.

## Screenshots show the whole phone

`session screenshot` saves the phone as you would see it: the app inside its Android or iPhone frame, with the status bar (clock, signal, Wi-Fi, battery), the camera cutout or Dynamic Island, and the gesture bar or home indicator. The app's pixels are placed in the frame at their real size. The picture is a PNG with a transparent background.

| | Android | iOS |
| --- | --- | --- |
| App area | 412x855 | 393x764 |
| Top | Status bar with punch-hole camera | Status bar with Dynamic Island |
| Bottom | Gesture bar | Home indicator |

The status bar follows the phone: it shows the phone's clock, and airplane mode or Wi-Fi off change its icons. Add `--no-frame` to save the app area alone.

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
```

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
| `build_failed` | The web build failed. The summary names the module or file. | Fix or stub that module for web, then start again. |
| `no_browser` | No Chromium was found and it could not be installed. | Run `shipvo doctor`. |
| `no_session` | No running session, or the id is unknown. | Run `shipvo session list`, or start one. |
| `session_stopped` | The session ended. | Start a new one. |
| `no_ffmpeg` | `record stop` did not find ffmpeg. | Install ffmpeg, then record again. |
| `recording_active` | `record start` was called while a recording runs. | Run `shipvo session record stop` first. |
| `no_recording` | `record stop` was called with no recording running. | Run `shipvo session record start` first. |
| `stale_ref` | The ref is not on the screen now. | Run `shipvo session screen` and use a ref from it. |

## Next steps

- [Run your app on a phone in your browser](run.md)
- [Agents and MCP tools](agents.md)
- [Simulator vs device parity](parity-results.md)
