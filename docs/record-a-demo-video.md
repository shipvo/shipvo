# Record a demo video

For founders working through an AI assistant. You get a short MP4 of your app with chapter markers, background music and a voice track. This page is a worked example. Options and error codes are in [Record a demo video of the phone](record.md).

## Before you start

- The simulator is running (`shipvo sim`) and your assistant is connected to `@shipvo/mcp`.
- `ffmpeg` and `ffprobe` on your PATH, and `python3` for music.
- `npm i -D playwright && npx playwright install chromium`.
- For narration, a `.wav` file with your voice, for example `narration.wav`. Without a music service, set `SHIPVO_MUSIC_FILE` to a local track (an mp3). Otherwise a track is picked from Jamendo.

## Ask your assistant

> Open the shop app. Record a vertical demo. Add a chapter at each screen. Open search. Stop and add music and my voice from `narration.wav`.

It makes these calls, in this order:

```text
open_app        { app: "tide" }                       -> session "tide-1a2b3c"
record_start    { format: "9:16", title: "demo" }     -> recording to .shipvo/recordings/demo-<time>.mp4 (1080x1920)
record_marker   { caption: "Home" }
tap             { session: "tide-1a2b3c", ref: "e9" } -> "Open search" (use a ref from the latest screen)
record_marker   { caption: "Search" }
record_stop     { music: true, narration: "narration.wav" }
end_session     { session: "tide-1a2b3c" }
```

`record_stop` returns the file, the length, the chapters and any notes:

```json
{
  "file": ".shipvo/recordings/demo-<time>.mp4",
  "duration_s": 0.692,
  "chapters": [{ "t": 0.003, "caption": "Home" }, { "t": 0.618, "caption": "Search" }],
  "notes": ["narration was 3.0 s and the video is 0.7 s: the narration was trimmed to the video length"],
  "credits": ".shipvo/recordings/demo-<time>.credits.json"
}
```

(Shortened. The run on the sample app had no waits between steps, so the video is under a second. Waits longer than 0.6 s are cut, so a real demo needs real actions.)

## Music

`music: true` mixes a music bed under the video. Open the `.credits.json` next to the MP4 and use its `credit_line` where you publish.

## Narration

`narration` is the path to a `.wav`. It is mixed over the video. If it is longer than the video it is cut to fit, and `notes` says so. If it is shorter, the rest is silent. With `music: true`, the music gets quieter while the voice plays. If the file is missing, you get the error `narration_unreadable` and the silent video is kept.

## Check the file

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:format=duration -of default=nw=1 .shipvo/recordings/demo-<time>.mp4
```

For the run above this printed an `h264` video stream at 1080x1920 and an `aac` audio stream.

## Next steps

- [Record a demo video of the phone](record.md): all options and error codes.
- [Videos](videos.md)
