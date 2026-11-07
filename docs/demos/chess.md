# Chess on two phones

Two Shipvo phones side by side, one Android and one iOS, both running our own chess app (`apps/chess`). Android plays white and iOS plays black. A move on one phone shows on the other. Each side has its own move timer.

## Run it

From the repository root, after `pnpm install` and `pnpm -r build`:

```bash
pnpm --filter chess demo
```

The command builds the chess web build if it is missing, starts the Android phone and the iOS phone, and opens the page. Tap a piece, then a square, to move.

To watch a full game play itself, add `--autoplay`:

```bash
pnpm --filter chess demo -- --autoplay
```

Options: `--port <n>` for the page port, `--no-open` to print the address without opening a browser.

## The timer

Each side has a clock above its phone. The clock of the side to move runs. A move hands the clock to the other side, and checkmate or a draw stops both.

## What CI measures

`apps/chess/test/demo.test.ts` runs the same code as the command, in Chromium, as part of `pnpm -r test`:

- A full game of 13 moves (Légal's mate) plays on both phones. Both show "Checkmate, white wins", and the page shows "Game over after 13 moves".
- A move made by tapping on the Android phone appears on the iOS phone, and the black clock starts running.
- Both clocks show minutes and seconds, and they stop when the game ends.

`apps/chess/test/link.test.ts` checks the move relay and the timer rules.
