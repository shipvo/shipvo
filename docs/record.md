# Record a demo video of the phone

For developers and founders who want a short MP4 of their app, with chapter markers, for a store page, a launch post or a bug report. Your assistant starts and stops the recording through three MCP tools; you get a video file.

## Before you start

- ffmpeg on your PATH (`ffmpeg -version` must print a version).
- The optional `playwright` package and a browser: `npm i -D playwright && npx playwright install chromium`.
- A page that shows the phone. By default this is the simulator's root address. To record a live `shipvo run` phone, set `SHIPVO_FRAME_URL` to its address (see [Run your app on a phone](run.md)).

## Steps

Ask your assistant: "Record a 30 second demo of the checkout. Add a chapter at each screen." It calls:

1. `record_start({ format: "9:16", fps: 30, title: "checkout demo" })`. Returns the file path and size, for example `1080x1920`.
2. The usual phone tools (`tap`, `type`, ...) while the recording runs. Call `record_marker({ caption: "Cart" })` at each screen.
3. `record_stop()`. Returns the file, `duration_s`, size and the chapters with their times.

The file is written to `.shipvo/recordings/<title>-<yyyymmddhhmmss>.mp4` in the folder where the MCP server runs (H.264, so it plays everywhere).

Waits longer than 0.6 s between actions are cut, including `wait_for` and `settle` waits. So `duration_s` is shorter than wall-clock time. Time inside one action is kept.

## Options

| Tool | Argument | Values |
| --- | --- | --- |
| `record_start` | `format` | `9:16` (1080x1920, default), `16:9` (1920x1080), `1:1` (1080x1080) |
| | `fps` | `30` (default) or `60` |
| | `title` | Used in the file name |
| | `background` | `brand`, `plain` or a CSS colour behind the phone |
| `record_marker` | `caption` | Required, a chapter title at the current time. It also shows on screen as a lower third until the next marker |
| `record_stop` | none | |

Only one recording runs at a time per server.

## Troubleshooting

| Error code | Meaning | Fix |
| --- | --- | --- |
| `recorder_unavailable` | Playwright or Chromium is missing. | `npm i -D playwright && npx playwright install chromium` |
| `frame_unreachable` | The frame page did not load. | Start the simulator or `shipvo run`, or fix `SHIPVO_FRAME_URL`. |
| `recording_active` | A recording is already running. | Call `record_stop` first. |
| `no_recording` | Marker or stop with nothing running. | Call `record_start` first. |
| `encode_failed` | ffmpeg failed, or is not installed. | Install ffmpeg and retry. |

## Next steps

- [Agents and Shipvo apps](agents.md): all MCP tools.
- [Videos](videos.md)
