# Lumi on Shipvo Phone

For anyone who runs their app on Shipvo Phone and wants to see what is happening, and for people who want the app tested while they watch. Lumi is a small glowing orb beside the phone's camera. You get live captions for each step, a reason when something fails, and `shipvo lumi`, which tests your app for you with no AI account needed.

## Start here (no technical background needed)

1. Open a terminal in your app folder (see the [glossary](glossary.md)) and type:

   ```bash
   npx shipvo lumi
   ```

   Use `npx shipvo lumi ios` for an iPhone-style phone.
2. Wait while Shipvo builds a web copy of your app. Your browser opens with the phone and the Lumi sidebar. On a wide window the phone is on the left and the sidebar on the right; on a narrow window the sidebar is below the phone.
3. In the box labelled **Tell Lumi what to do**, type `test my app` and press Enter (or press **Send**). Lumi taps through your app. The sidebar lists each action as it happens.
4. Look at **Findings** in the sidebar. Each finding is a problem Lumi found, such as a button that does nothing or a screen that stays blank. Press **Replay** to watch it happen again.
5. When you are done, go back to the terminal and press **Ctrl+C**.

Lumi runs on your computer. It answers only requests from its own page.

**If it fails:**
- The terminal shows `Building <your app> for the simulator…` and then an error from `npx expo export --platform web`: the error names a file that uses something that only works on a real phone. Ask your assistant to fix it. Run `npx expo export --platform web` yourself to see the same error.
- The sidebar says `Could not reach Lumi. Is shipvo lumi still running?`: the terminal was closed. Run the command again.
- The terminal says `Port 4547 is in use. Pass --ui-port <n>.`: pass another, for example `--ui-port 4600`. For `Port 4546 is in use.`, pass `--port <n>`.

## What Lumi shows

| State | When |
| --- | --- |
| Idle | Nothing is happening. |
| Working | An agent or a test is acting. A caption names the step, such as "Tapping Checkout" or "Typing into Promo code". |
| Happy | A check passed or a flow finished. |
| Worried | An action failed, a check failed, the app crashed or threw a page error. The reason is the real error and is in the orb's tooltip. |

On a new Shipvo Phone, Lumi shows a three-step first-run guide: the home screen, the Store, and connecting an assistant. You can skip it. It does not show again in that browser.

Lumi is drawn outside the app's screen. Screenshots, agent recordings and the screen tree are the same with Lumi on or off. `record_start` keeps Lumi and its captions in the video by default (`lumi: false` hides them) and can speak them with `lumi_voice: true` (see [Record a demo video](record.md)).

### Turn Lumi off

- Environment: `SHIPVO_LUMI=off`. Lumi is off by default in CI; `SHIPVO_LUMI=on` shows it there.
- Code: `renderFrame({ lumi: false })`.

## `shipvo lumi` for developers

```bash
shipvo lumi [android|ios] [--port 4546] [--ui-port 4547] [--sim <url>] [--skip-build] [--no-open] [--max-steps 100] [--max-depth 3] [--seed 1]
```

| Option | What it does |
| --- | --- |
| `android` or `ios` | Phone skin. |
| `--ui-port` | Port of the Lumi page (default 4547). |
| `--port` | Port of the simulator (default 4546). |
| `--sim <url>` | Use a simulator that is already running. |
| `--skip-build` | Reuse the last web build. |
| `--no-open` | Do not open the browser. |
| `--max-steps`, `--max-depth`, `--seed` | Same as [`shipvo explore`](cli.md): how far Lumi walks, and the seed that makes a run repeat. |

The sidebar has a live feed, findings (each with a Replay button), coverage (screens and controls tried) and a command box. Commands are plain text, no AI:

| Command | Does |
| --- | --- |
| `test my app` | Walks the app from the start screen. |
| `test <flow>` | Walks one flow. A flow is a name from `routes` in `shipvo.json` or a control on the start screen, such as `cart`. |
| `try <flow> with bad input` | Same flow with invalid values in text fields. |
| `stop` | Stops the current run. |
| `replay bug <n>` | Replays finding number `n`. |
| `save bug <n> as test` | Same as the Save as test button. Writes `tests/lumi/lumi-<kind>-<n>.test.ts`. |
| `help` | Lists the commands. |

Other text gets the short list of commands.

### Save a finding as a test

Each finding has a Save as test button. It writes a `@shipvo/test` file to `tests/lumi/` that replays the steps and fails while the bug is there. Run it with `shipvo test`.

In CI, `shipvo explore --save-tests <dir>` writes one file per finding. Names are `lumi-<kind>-<n>.test.ts`, built from the finding kind and its position, never from text in the app.

### In the page and in code

- `window.shipvoLumi.say(text, state, holdMs)` shows a caption.
- `shipvoLumi.react({ kind, name?, error?, detail? })` reacts to a result. `shipvoLumi.set(state, reason?)` sets a state.
- `lumiReaction` is exported from `@shipvo/sim/lumi.mjs`.
- `renderFrame` takes `guide` (default `false`; `shipvo run` turns it on).

## Troubleshooting

- **No orb on the phone**: check `SHIPVO_LUMI`. In CI it is off unless you set it to `on`.
- **Different findings each run**: pass the same `--seed`.

## Next steps

- [Tutorial: have Lumi test your app while you watch](tutorials/test-your-app-with-lumi.md)
- [Run on a phone in your browser](run.md)
- [`shipvo explore` and flows](cli.md)
- [Test with an assistant](test-with-an-assistant.md)
