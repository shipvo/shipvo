// Labels for the board and the move list. Pure functions of the game.
import { describeMove, describePieceAt, squareName, startPosition, applyMove, type Game, type Square } from "./engine.js";

export interface SquareView {
  name: string;
  /** "white knight on g1" or "empty square e4" */
  label: string;
  /** Piece letter, upper case for white, or "" */
  piece: string;
  dark: boolean;
}

/** 64 squares from rank 8 down to rank 1, files a to h. */
export function boardView(game: Game): SquareView[] {
  const out: SquareView[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const sq: Square = rank * 8 + file;
      const p = game.position.board[sq];
      out.push({
        name: squareName(sq),
        label: describePieceAt(game.position, sq),
        piece: p ? (p.color === "w" ? p.type.toUpperCase() : p.type) : "",
        dark: (rank + file) % 2 === 0,
      });
    }
  }
  return out;
}

/** One line per move: "1. white pawn from e2 to e4". */
export function moveList(game: Game): string[] {
  let pos = startPosition();
  return game.moves.map((m, i) => {
    const text = `${i + 1}. ${describeMove(pos, m)}`;
    pos = applyMove(pos, m);
    return text;
  });
}
