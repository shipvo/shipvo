# Episode: "Lumi tests Amara's app" (slice 1 of #884)

Cast: Amara (`af_heart`, warm) and Lumi (`af_jessica`, energetic), as in the video prompt. Lumi is also the host. Length about 45 s, 16:9. Characters and rooms are drawn in code. Every Shipvo screen is a real recording of `npx shipvo lumi` on Tide & Tackle, made with `record_start` / `record_stop`.

Dialogue: `scripts/video/scripts/lumi-tests-amaras-app.dialogue.json` (8 lines). Voices are recorded first with `python3 scripts/video/dialogue.py`, then the picture is rendered from `mouth.js`.

## Shot list

| Time | Shot | Source |
| --- | --- | --- |
| 0 to 5 | Amara at her desk, late light, her app open on a phone. "I finished my app. Does every button work?" | drawn |
| 5 to 10 | Lumi drifts in beside the phone's camera. "Let me check!" | drawn |
| 10 to 17 | The phone taps by itself; captions name each step. Amara leans in. | recording: `test my app` |
| 17 to 22 | A finding appears in the sidebar. Lumi turns worried. | recording: Findings list |
| 22 to 32 | Amara: "Show me again." Replay plays the problem on the phone. | recording: Replay |
| 32 to 40 | Amara fixes it, runs `test my app` again, Lumi turns happy. | recording + drawn |
| 40 to 45 | Lumi to camera: "Next on Shipvo." End card: `npx shipvo lumi`, shipvo.dev/docs/lumi | drawn |

## Rules for the recording

- Record on Tide & Tackle with the same seed in both takes, on the Android skin and on the iOS skin, and use the same cut for each.
- Any finding, count or number shown on screen is read from the recording itself, and the description links the run.
- At most three captions: "Lumi taps through your app." "Every problem, once." "Replay it." Each is 7 words or fewer.
