# Story ad storyboard: "From a chat to an app on every assistant" (slice 1 of #860)

Cast from `scripts/video/cast/README.md` (Mara, Jun, Dana, Pip). Main cut 1:40, 16:9. Short cut 0:35, 9:16, edited from the main cut. Characters, shop and street are drawn in code; every Shipvo screen is a real recording.

## Real recordings (made on the runner with `record_start` / `record_stop`)

Made by `scripts/video/story/record-screens.mjs` against a live `shipvo run android` phone, driven through `@shipvo/mcp`. Tide & Tackle sample app, 1080x1920, 30 fps. The phone screen sits at x 197, y 512, 412x910 in the frame.

| File (in `/tmp/agent/media/story-ad/`) | Length | What it shows |
| --- | --- | --- |
| `story-order.mp4` | 9.1 s | One order: 2 x Chrome Spoon, shop pickup, cash. Ends on "Order TT-1001 placed", total 5 600 FCFA. |
| `story-rush.mp4` | 26.6 s | Three orders in a row: TT-1001 2 800, TT-1002 3 900, TT-1003 4 200 FCFA, then My orders. |
| `contact-order.png`, `contact-rush.png` | | Ten-frame contact sheets of the phone area. |

Numbers on screen come from these recordings only. Prices are read from the app's list (Chrome Spoon 2 800, Metal Jig 3 900, Surface Popper 4 200 FCFA).

## Shot list

| Time | Shot | Camera | Source |
| --- | --- | --- | --- |
| 0 to 5 | Street at golden hour, people walking past the shop with phones | wide, slow dolly | drawn |
| 5 to 14 | Mara at an empty counter | push-in on face | drawn |
| 14 to 22 | A customer looks at their phone, then walks away from the window | close-up, whip-pan | drawn |
| 22 to 32 | Door bell. Jun types "Make my shop an app every assistant can use." | over-shoulder | drawn chat |
| 32 to 44 | The shop's app appears on the phone | close-up, zoom on the tap | `story-order.mp4`, first 4 s |
| 44 to 60 | Dana's assistant (Pip) orders 2 Chrome Spoons | split: Dana, phone | `story-order.mp4` |
| 60 to 76 | Rush: three orders in a row. Mara looks up, surprised | cuts between Mara and phone | `story-rush.mp4` |
| 76 to 90 | Orders list fills. Mara relieved | push-in | `story-rush.mp4`, last 6 s |
| 90 to 96 | Busy shop at sunset, confetti | wide | drawn |
| 96 to 100 | End card: paper-plane mark, "Every assistant can use your app.", shipvo.dev | | drawn |

Dialogue, 8 lines (Lumi voices Pip as host per the cast rule): Mara "Nobody comes in." Jun "Wait, I can fix that." Pip "Found it. Ordering now." Dana "Whoa, that was quick." Mara "Another one?" Mara "Three orders!" Pip "All done." Lumi "Next on Shipvo."

## Captions (three, one beat each, 7 words or fewer)

1. 6 s: "From a chat to an app."
2. 46 s: "Your assistant can order."
3. 78 s: "Every order, in one list."

## Built so far

The 9:16 cut is built by `render-story.mjs --vertical` from `story/vertical.mjs` (ten segments, 37.8 s) and `story/vertical-audio.py`. Scenes 1 to 10 (0 to 100 s) are in `story/scenes.mjs`: street, counter, walk-away, chat, app, order, rush, orders list (caption 3), sunset with confetti, end card. `render-story.mjs` takes `--rec-order` and `--rec-rush` (real recordings from `record-screens.mjs`). Left: dialogue voices and lip sync, sound, music pick with credits, the 9:16 cut, the next-episode trailer, pacing gate and upload.

## Not in this slice

Final render, music, sound, lip sync and launch kit. Screens for `create_app` and the install card are not recordable on main yet, so the sample app stands in; re-cut when they ship.
