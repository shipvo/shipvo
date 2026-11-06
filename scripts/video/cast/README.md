# The Shipvo cast

Four original recurring characters for story ads. Designs are our own. Each is built from simple shapes in `rig.mjs` (`CAST`). Colours below are the values in code.

Shared look: soft outlines in warm near-black (`#2b1d24`), large glossy eyes with two highlights, flat colour with one shade tone, golden-hour light by default.

**Expressions (all four):** `neutral`, `happy`, `sad`, `surprised`, `worried`, `determined`, `thinking`, `relieved`.

## Mara Okonkwo-Reyes, the small-shop owner
- **Personality:** warm, stubborn, proud of her regulars. Worries out loud, then rolls up her sleeves.
- **Palette:** amber top `#e8a33d`, cream apron bib `#fff2d6`, slate trousers `#3b4a6b`, deep brown hair `#2a1a2e`, brown eyes.
- **Silhouette:** wide shoulders, a round hair bun on the left. Reads as a rounded triangle.
- **Outfit:** work shirt with a cream apron bib.
- **Voice:** low, warm, unhurried; speeds up when worried; a short laugh when relieved.

## Jun Aalto, the young founder
- **Personality:** quick, curious, a little over-caffeinated. Calm once there is a plan.
- **Palette:** indigo hoodie `#4b4fa3`, mint collar `#8fe3d4`, dark trousers `#2c2f4a`, teal hair `#1f6f6a`, blue eyes.
- **Silhouette:** narrow, with a spiky, jagged fringe.
- **Outfit:** hoodie with a mint collar.
- **Voice:** light and fast, rising at the end of ideas; drops to steady when they say "I can fix it."

## Dana Whitlock, the busy parent
- **Personality:** practical, funny under pressure, does three things at once. Wants things to just work.
- **Palette:** coral jacket `#d9534f`, blush pocket band `#f7d9c0`, sage trousers `#5a6b52`, auburn hair `#5a2a1a`, green eyes.
- **Silhouette:** long shoulder-length hair that flares at the ends; wide at the bottom.
- **Outfit:** jacket with a wide pocket band.
- **Voice:** mid-range, dry, clipped sentences; softens when a child is mentioned.

## Pip, the assistant
- **Personality:** gentle, eager, always a step ahead. Never talks down.
- **Palette:** pale light-yellow body `#fff6c9`, golden glow `#ffd35c`, brown line `#5a3a12`.
- **Silhouette:** a soft teardrop of light with a small flame-like tuft, floating and bobbing. Glow rings pulse.
- **Outfit:** none.
- **Voice:** bright, slightly high, clear; short phrases, a chime-like lift on good news.

## Rig API (`rig.mjs`)

```js
import { createCharacter, CAST } from "./rig.mjs";
const c = createCharacter(CAST.mara, { seed: 1 });
c.pose("talk", { at: 0.2 });            // idle talk lean shrug think cheer
c.expression("happy", { at: 1 });       // the 8 expressions
c.lookAt(0.8, 0, { at: 1 });            // x, y in -1..1; eyes and head turn
const end = c.say("hello there", { at: 2 }); // text, or [{ v: "O", d: 0.1 }, ...]
c.gesture("point", { at: 3, dur: 1.2 }); // open point fist wave thumbsUp cup
const svg = c.render(3.5, { x: 100, y: 40, scale: 1, flip: false });
```

Visemes: `rest A E I O U MBP FV`. `render(t)` depends only on the calls made and `t`, so any frame can be rendered alone. Hair sways on its own with a lag; blinks come every 3.4 s, offset by `seed`.

## Camera and light (`../camera.mjs`)

`pushIn`, `dolly`, `whipPan` (with blur), `matchCut`, `cutFade`, `cameraAt(shots, t)`, `parallax(layers, camera)`. All moves are eased. Light: `TIME_OF_DAY`, `sky`, `glow`, `lightRays`, `particles`, `grain`, `vignette`.

## Test scene

`node scripts/video/cast/testscene.mjs [outdir]` renders a 10 s scene (Mara and Jun talking, Pip glowing above) to `cast-test-scene.mp4` plus a contact sheet. Tests: `node --test scripts/video/cast/rig.test.mjs`.
