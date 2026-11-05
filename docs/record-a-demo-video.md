# Record a demo video

An assistant can record a demo video of your app while it uses it. The video shows the app in a phone frame on a clean background, with a dot and ripple on every tap and a trail on every scroll. Use it for the site, the stores and founder updates.

Three tools in `@shipvo/mcp` do it:

| Tool | What it does |
|---|---|
| `record_start` | Starts recording a session. Options: `format` (`9:16`, `16:9` or `1:1`), `fps` (30 or 60), `background` (`brand`, `plain` or a CSS colour such as `#0b1220`), `show_taps`, `title`. |
| `record_marker` | Adds a caption (lower third) from this moment, for example "Add to cart". Each marker is also a chapter. |
| `record_stop` | Encodes the video and returns `{ file, duration_s, width, height, chapters: [{ t, caption }] }`. Optional `narration` (path of a WAV file) and `music` (true). |

## Example

Ask your assistant: "Open the app, record a 9:16 demo that adds a rod to the cart, with a caption at each step."

```
open_app        -> session tide-1
record_start    { session: "tide-1", format: "9:16" }
record_marker   { session: "tide-1", caption: "Pick a rod" }
tap             { session: "tide-1", ref: "e12" }
record_marker   { session: "tide-1", caption: "Add to cart" }
tap             { session: "tide-1", ref: "e31" }
record_stop     { session: "tide-1" }
```

`record_stop` answers with something like:

```json
{ "file": ".shipvo/recordings/tide-1-2026-11-05T10-00-00-000Z.mp4", "duration_s": 9.4, "width": 1080, "height": 1920,
  "chapters": [{ "t": 1.2, "caption": "Pick a rod" }, { "t": 4.0, "caption": "Add to cart" }] }
```

(The numbers above show the shape. They are not a measurement.)

## What the video looks like

- 1080x1920 for 9:16, 1920x1080 for 16:9, 1080x1080 for 1:1. H.264, `yuv420p`, `+faststart`.
- The phone is centred on the background.
- Long waits (network, the assistant thinking) are cut to at most 0.6 s, so the demo moves at a human pace.
- Captions are drawn from each marker until the next one, at most 4 s.

## Narration and music

`narration` is a WAV file you made. `music: true` adds a ducked music bed with `scripts/video/bgmusic.py` (needs `python3`, run from a checkout of this repository, or set `SHIPVO_BGMUSIC` to the script). It writes `<video>.credits.json` next to the video. Credit the track wherever you publish.

## Requirements

- `ffmpeg` with `libx264` on the machine that runs `shipvo-mcp`. Set `SHIPVO_FFMPEG` for another binary. Without it, `record_stop` fails with code `ffmpeg_missing`.
- Captions on screen need an ffmpeg with `drawtext`. Set `SHIPVO_FONT` to a font file if it finds none. Without `drawtext` the video has no caption text and the chapters are still returned.
- Videos are saved under `.shipvo/recordings/` (change with `PN_RECORD_DIR`).

## Limits today

- The video is built from a screenshot after each action, so it shows each screen as it was after the action. Typed text appears at once, not letter by letter, and animations inside a screen are not captured.
- Taps are drawn at the middle of the element tapped. `type` and `back` draw no touch.
- The hosted simulator records on the server and does not yet return a download link.
