# Video tooling

Videos are built in code: HTML/CSS/SVG scenes in the Shipvo brand, rendered frame by frame with headless Chromium, with narration from `narrate_hosted.py` (Kokoro, voice `af_heart`).

```bash
# 1. narration: one blank-line-separated block per scene
python3 scripts/video/narrate_hosted.py --file vo.txt --voice af_heart --speed 1.0 --pause 0.45 --out vo.wav --manifest vo.json
# 2. render (needs ffmpeg, Chromium, and playwright-core: `mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright-core`)
PW_DIR=/tmp/pw node scripts/video/render.mjs <slug> --vo vo.wav --manifest vo.json --out services/site/public/videos
# spot-check frames at given seconds instead of rendering: add  --only-frames 4,12,40
```

- `scripts/<slug>.json`: the script. Each scene has `narration` (written for the voice), optional `caption` (same sentences, written for the eye), `visual` (a key in `scenes.mjs`) and `min` seconds.
- `plan.mjs`: scene timing and caption cues from the narration manifest. Tested: `node --test scripts/video/plan.test.mjs`.
- `scenes.mjs` + `deck.html`: the scenes. Animations are CSS and are seeked per frame, so output is deterministic.

## Runner setup

No local Kokoro or Python TTS package is needed. `narrate_hosted.py` only uses the standard library and calls a hosted endpoint, so do not check `import kokoro`. The only extra install is `playwright-core` in `/tmp/pw` (step 2 above).

## Runner without ffmpeg

If `ffmpeg` is missing, get a static build without root: `pip download imageio-ffmpeg --no-deps -d /tmp/ff/dl`, unzip the wheel in an empty folder and copy `imageio_ffmpeg/binaries/ffmpeg-*` to `/tmp/bin/ffmpeg`. It has libx264, AAC and the filters `bgmusic.py` needs. It has no `ffprobe`: `npm i @ffprobe-installer/linux-x64` in `/tmp/pw` and copy its `ffprobe` to `/tmp/bin`. Add `/tmp/bin` to `PATH`.
