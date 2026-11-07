# Chess on two phones

For developers and for anyone who wants to see what two Shipvo phones and two assistants can do. You can watch the game on [shipvo.dev/demos/chess](https://shipvo.dev/demos/chess/) with nothing to install, or run it yourself with the commands below. On the site page, press "Play against it" to take white; the page answers for black.

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

## Two assistants

Two real assistants, for example Claude and ChatGPT, can play each other on the two phones. Each one reads the labelled board through `@shipvo/mcp`. Any agent that runs stdio MCP works, local or hosted, one per side.

```bash
pnpm --filter chess demo -- --agents
```

1. The command starts the Android phone (white) and the iOS phone (black) as live runs, and prints for each side the MCP config and the prompt to give that agent. The config starts `@shipvo/mcp` in the folder of that phone, so it attaches to the right one.
2. Add each config to its assistant and paste its prompt. White's prompt reads: "You play white in session white. Call open_app with app "chess" and session "white". Read the board with get_board (the screen tool) ... Wait for your turn."
3. When both assistants are connected, press "Start the clock" on the page.

How a side plays: `screen` is `get_board`. It lists the 64 labelled squares, says whose turn it is and the last move. Tapping one of your pieces marks the squares it can reach as "legal move", which is `legal_moves`. Tapping a marked square makes the move.

Turn order is enforced by the app. A move out of turn is refused and the screen says "It is white's turn. You play black. Wait for your turn." The game ends on checkmate, stalemate, a draw rule or a move that takes longer than the move time. The page shows the result.

Options: `--move-time <seconds>` (default 60), `--white-name <name>` and `--black-name <name>` for the names shown beside the clocks.

### Record the game

```bash
pnpm --filter chess demo -- --agents --record
```

The recorder from `@shipvo/mcp` records the page: both phones, both clocks, the agent names and the move list, in one video. When the game ends the command prints the paths of the video and of the moves file (`game.pgn`). Both are written to a temporary folder outside the repository. Upload large videos to R2; do not commit them.

`apps/chess/test/agents.test.ts` plays fool's mate (1. f3 e5 2. g4 Qh4#) with two scripted MCP clients, with no AI: the moves land on both phones, out-of-turn moves are refused, the result shows "Checkmate, black wins", and the PGN matches. It also checks that a side that exceeds the move time loses.

## The timer

Each side has a clock above its phone. The clock of the side to move runs. A move hands the clock to the other side, and checkmate or a draw stops both.

## What CI measures

`apps/chess/test/demo.test.ts` runs the same code as the command, in Chromium, as part of `pnpm -r test`:

- A full game of 13 moves (Légal's mate) plays on both phones. Both show "Checkmate, white wins", and the page shows "Game over after 13 moves".
- A move made by tapping on the Android phone appears on the iOS phone, and the black clock starts running.
- Both clocks show minutes and seconds, and they stop when the game ends.

`apps/chess/test/link.test.ts` checks the move relay and the timer rules.

## Troubleshooting

- **The page does not open**: run with `--no-open` and open the printed address yourself. Use `--port <n>` if the port is taken.
- **The web build is missing**: the command builds it on first run. If that fails, run `pnpm -r build` from the repository root and try again.
- **An assistant's move is refused**: it is not that side's turn. The phone shows whose turn it is and the last move.
- **A side lost on time**: raise `--move-time <seconds>` (default 60).

## Next steps

- [Agents and Shipvo apps](../agents.md)
- [Record a demo video](../record.md)
- [Run on a phone in your browser](../run.md)
