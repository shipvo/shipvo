# Story ad: "From a chat to an app on every assistant"

The first Shipvo story ad (main cut 1:44, 16:9; short cut 0:35, 9:16). It follows "Story ads: the craft standard" in `.github/agents/prompts/video.md`.

**Story.** Mara (the shop owner, from the cast) watches customers walk past with their phones. Her nephew Jun (the young founder) opens a chat: "Make my shop an app every assistant can use." The app appears on the phone. A customer's assistant, Pip (the companion shape), finds the shop and orders. Orders keep coming at golden hour. End card: Shipvo, "Every assistant can use your app.", shipvo.dev.

| Time | Scene | What happens |
| --- | --- | --- |
| 0 to 5 s | `street` | Hook. Customers pass the shop with their phones. Caption 1. |
| 5 to 22 s | `shop`, `empty` | Mara at an empty counter; a customer walks away from the window. |
| 22 to 41 s | `jun`, `chat` | The door bell. Jun types the request. Caption 2. |
| 41 to 53 s | `app` | The shop's app appears on the phone (real recording). |
| 53 to 71 s | `order` | Dana's assistant orders (real recording). Caption 3. |
| 71 to 86 s | `rush` | A rush: three orders in a row (real recording). |
| 86 to 100 s | `payoff` | Busy shop at golden hour; the orders list. |
| 100 to 104 s | `end` | End card. |

## Files

- `from-a-chat.mjs`: the film as pure functions. `frameSvg(t)` is one frame; same `t`, same string. Timeline, captions, sound cues, the vertical cut list.
- `audio.mjs`: synthesised sound effects (ffmpeg sine and noise, so no effects library to credit), the music bed and the final mix at -14 LUFS.
- `render-story.mjs`: renders frames with headless Chromium and muxes video and sound.
- `record-screens.mjs`: makes the two real screen recordings with `record_start` and `record_stop`.
- `from-a-chat.main.brief.json`, `from-a-chat.short.brief.json`: the `musicpick.py` briefs for each cut.
- `story.test.mjs`: the craft rules as tests. `node --test scripts/video/story/story.test.mjs`.

## Make it

```bash
# 1. real screens (needs the sample app built; see record-screens.mjs for the two steps)
FRAME=http://127.0.0.1:<port>/ node scripts/video/story/record-screens.mjs order
FRAME=http://127.0.0.1:<port>/ node scripts/video/story/record-screens.mjs rush
# 2. crop the phone out of each MP4 into 30 fps frames (the phone sits at x 324, y 485, 432 x 950 in the 1080 x 1920 recording)
for n in order rush; do mkdir -p ph/$n; ffmpeg -i <$n.mp4> -vf "fps=30,crop=432:950:324:485,scale=324:-1" -q:v 4 ph/$n/%04d.jpg; done
# 3. render both cuts
node scripts/video/story/render-story.mjs --phones ph --out out --music-main m.mp3 --offset-main 0 --music-short m.mp3 --offset-short 178.5
# 4. pick the music again from the briefs, and check the pacing of both renders
python3 scripts/video/musicpick.py --brief scripts/video/story/from-a-chat.main.brief.json
python3 scripts/video/musicpick.py --brief scripts/video/story/from-a-chat.short.brief.json
python3 scripts/video/pacing.py out/from-a-chat.mp4 && python3 scripts/video/pacing.py out/from-a-chat-vertical.mp4
```

Edit rules that `pacing.py` enforces with its defaults: every scene change is a hard cut, and `ANGLE_CUTS` in `from-a-chat.mjs` adds a cut inside each long scene, so no stretch runs 6 s without a cut. The retention map is in `scripts/video/scripts/from-a-chat.json`; the series plan is `scripts/video/series.json` (this film is S1 · E1).

## What is real, what is drawn

Real: every screen of the shop's app. They are recordings of the Tide & Tackle sample app in the simulator, driven through the MCP server (`open_app`, `tap`, `record_start`, `record_stop`). The frame is the simulator's own ("Simulated" label included). The numbers the film shows come from those recordings: order TT-1001 (1 x Chrome Spoon, 2 800 FCFA) in the `order` beat, and the same order first in the list in the `rush` beat: TT-1001, TT-1002, TT-1003 (2 800, 3 900 and 4 200 FCFA). One order, one total.

Drawn by us in code: the street, the shop, the characters (the cast rig), the chat on Jun's phone (a drawn mock, not the real product), light, grain and the end card. No AI-generated images or footage.

Known gaps: the sample app's own screens stand in for the shop's app. The tap sounds are placed by hand near the taps in the recording, not locked to frames.
