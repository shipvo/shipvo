# Demo: two assistants play chess on Shipvo Phone

For anyone who wants to watch two AI assistants play a full game of chess on a simulated phone, or reuse the chess app as a template. You will learn what the app gives an assistant and how to run it.

This is our own app. We never point assistants at a third-party chess site: bots break their fair-play rules.

## What the app gives an assistant

The app is in `apps/chess`. It is a Shipvo app and a template.

- Every square has a label: `e4, white pawn` or `e5, empty`. A selected square and a legal target say so in the label too.
- The app checks every rule: check, castling, en passant, promotion, checkmate, stalemate, and draws by repetition, the automatic 50-move draw and too few pieces.
- A move list and a status line (whose turn, check, result) are on screen, and a timer shows how long the side to move has been thinking.

Typed actions live in `apps/chess/src/actions.ts`:

| Action | Returns |
| --- | --- |
| `get_board()` | whose turn, the status, eight rows of labelled squares, the pieces and the move list |
| `legal_moves(from?)` | every legal `{ from, to }` for the side to move, or only those from one square |
| `move(from, to, promotion?)` | `{ ok: true, move, board }`, or `{ ok: false, code, error }` with `bad_square`, `game_over`, `no_piece`, `not_your_piece`, `illegal_move` or `promotion_needed` |

On the phone, an assistant plays with taps: tap the piece, then the target square. It reads the board from the screen tree. The tap path promotes to a queen.

## Run it

```bash
cd apps/chess
pnpm web
```

This starts the app in a browser through Expo. A "New game" button (44 px tall) starts again after a result. The app follows the system light or dark setting; see the screenshots in the pull request for both.

We have not yet run it in a Shipvo Phone session with an assistant connected. The plan is to connect an assistant through `@shipvo/mcp` (see [Test with an assistant](../test-with-an-assistant.md)) and ask it to play white, then to run a second phone for the second assistant and pass moves between them. That is the plan, not working behaviour today.

Check the rules engine on its own:

```bash
pnpm --filter chess test
```

The tests include the standard move counts from the start position (20, 400 and 8,902 at depths 1 to 3).

## What is not done yet

This is the first slice: the app, its rules and its tests. Still to do:

- Two phones side by side on one page, with the move timer for each side.
- The recorded video, with music and credits, and the launch kit.
- Exposing `get_board`, `legal_moves` and `move` as tools on the phone. Today they are the app's typed API in code.

Known gaps in the rules: king and bishop against king and bishop on same-colour squares is also a draw, and the app does not detect it yet. The tap path always promotes to a queen.
