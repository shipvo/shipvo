# Add narration and music to a demo video

For a founder who wants a short demo video of their app, with chapter titles, a voice-over and quiet background music. Your assistant drives the phone through MCP tools and the result is one MP4.

[Record a demo video of the phone](record.md) covers the video itself (formats, idle trimming, captions, backgrounds). This page adds sound.

## Before you start

- ffmpeg and ffprobe on your PATH.
- The optional `playwright` package and a browser: `npm i -D playwright && npx playwright install chromium`.
- `@modelcontextprotocol/sdk` to run the example below: `npm i -D @modelcontextprotocol/sdk`.
- A simulator running at `http://localhost:4545` with your app (see [Getting started](getting-started.md)).
- For `music: true`: `python3`, network access, and a Shipvo checkout. Music comes from `scripts/video/bgmusic.py`, which is not in the npm package. Run the MCP server from a checkout, or set `SHIPVO_VIDEO_SCRIPTS` to a copy of the `scripts/video` folder.
- For narration: a WAV file with your voice-over.

## Run it

Save this as `record-demo.mjs` and run `node record-demo.mjs`. Change `APP` to your app id (`list_apps` shows them). Leave out `narration` for a video with music only.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const APP = "tide";
const client = new Client({ name: "demo", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["-y", "@shipvo/mcp"] }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.structuredContent ?? r.content)}`);
  return r;
};

await call("record_start", { format: "9:16", title: "demo", background: "brand" });
const { structuredContent: first } = await call("open_app", { app: APP, session: "demo" });
await call("record_marker", { caption: "Open the app" });

// Tap the first button on the screen. Refs look like [ref=e3] in the screen text.
const screen = (await call("screen", { session: "demo" })).content[0].text;
const ref = /\[ref=(e\d+)\]/.exec(screen)?.[1];
if (ref) { await call("record_marker", { caption: "Tap a button" }); await call("tap", { session: "demo", ref }); }

const done = await call("record_stop", { narration: process.env.NARRATION, music: true });
console.log(done.structuredContent);
await client.close();
```

`record_stop` takes two optional arguments:

| Argument | Meaning |
| --- | --- |
| `narration` | Path to a WAV file. It is padded with silence or cut so the audio is as long as the video. |
| `music` | `true` mixes a music bed under the narration. The bed is lowered while the voice speaks. |

With `music: true` the server writes `<video>.credits.json` next to the MP4 and returns its path as `credits`. The file names the track, artist and licence. The track is licensed CC BY-SA 3.0, so the licence name and link in that file must be shown with the video, not only the `credit_line`. Share-alike terms can also apply to the video, so read the licence before you publish.

Set `NARRATION=/path/to/voice.wav` to add a voice-over, or leave it unset for music only.

If the audio step fails, the silent MP4 is kept and the result has an `audio_error` with a `code`:

| Code | Meaning | Fix |
| --- | --- | --- |
| `narration_not_found` | The WAV path does not exist. | Check the path. |
| `music_unavailable` | `bgmusic.py`, python3 or the network is missing. | See "Before you start". |
| `audio_failed` | ffmpeg or `bgmusic.py` failed. | Read the message; check the WAV plays. |

## Next steps

- [Record a demo video of the phone](record.md)
- [Agents and Shipvo apps](agents.md)
