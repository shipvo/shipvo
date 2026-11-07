# Launch kit: chess on an Android phone and an iPhone

Drafts for the owner to post. Every statement is from `docs/demos/chess.md`, `changes/1153-chess-demo-page.md` and `changes/1154-chess-agents.md`. The CI measurements are in `apps/chess/test/demo.test.ts` (a full 13-move game on both phones) and `apps/chess/test/agents.test.ts`. No other numbers are claimed.

Links: [live demo](https://shipvo.dev/demos/chess/), [docs](../../demos/chess.md), [features page](https://shipvo.dev/features/).

## X post (under 280 characters)

An Android phone and an iPhone play chess in your browser. Android is white, iOS is black, each with a clock. Take white, or point two AI assistants at the phones through MCP and let them play. https://shipvo.dev/demos/chess/

## LinkedIn post

One game of chess, on an Android phone and an iPhone, in your browser.

Both phones run the same chess app on Shipvo Phone. Android plays white and iOS plays black. A move on one shows on the other, and each side has its own clock.

Three ways to use it:

- Watch a full game play itself.
- Press "Play against it" and take white.
- Run `pnpm --filter chess demo -- --agents` and give each phone to an AI assistant over MCP. Turn order is enforced by the app. `--record` saves the game as a video and a PGN.

Every square and piece has a label, so an agent reads the board the same way a screen reader does.

https://shipvo.dev/demos/chess/

## Show HN-style description

A chess app (`apps/chess`) running on two Shipvo phones side by side, one Android skin and one iOS skin, served as static files at shipvo.dev/demos/chess. Moves relay between the phones and each side has a move timer. With `--agents`, each phone is a live run that an MCP client attaches to by session name, so two assistants can play each other; the app refuses moves out of turn and ends the game on checkmate, a draw rule or a move-time limit. `--record` writes an mp4 and a PGN. CI plays a full 13-move game on both phones in Chromium and checks that both show the result. Live: https://shipvo.dev/demos/chess/ Docs: https://github.com/shipvo/shipvo/blob/main/docs/demos/chess.md

## 30-second demo script (Video Studio)

1. 0-6 s: Open shipvo.dev/demos/chess. Android and iOS phones show the start position, two clocks.
2. 6-14 s: Press "Play against it". Tap a white pawn, then a square; the move shows on the iOS phone and black's clock starts.
3. 14-22 s: Terminal: `pnpm --filter chess demo -- --agents`. It prints the MCP config and prompt for white and black.
4. 22-28 s: Page with two agent names; moves land one after the other; the page shows the result.
5. 28-30 s: Caption: "Two phones. Two agents. shipvo.dev/demos/chess".
