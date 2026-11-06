// The typed actions an assistant calls: get_board, legal_moves, move. Same data the screen shows.
import { IllegalMove, legalMoves, move, name, newGame, result, squareLabel, type Color, type MoveRecord, type Promotion, type Result, type Square, type State } from "./engine";

export type BoardView = {
  turn: Color;
  status: Result;
  /** Eight rows, rank 8 first. Each square is "e4: white pawn" or "e5: empty". */
  rows: string[][];
  pieces: Record<Square, string>;
  moves: MoveRecord[];
};
export type ActionError = { ok: false; code: IllegalMove["code"]; error: string };
export type MoveOk = { ok: true; move: MoveRecord; board: BoardView };

export function view(s: State): BoardView {
  const rows: string[][] = [];
  const pieces: Record<Square, string> = {};
  for (let r = 8; r >= 1; r--) {
    const row: string[] = [];
    for (const f of "abcdefgh") {
      const at = `${f}${r}`;
      row.push(squareLabel(s, at).replace(", ", ": "));
      if (s.board[at]) pieces[at] = name(s.board[at]);
    }
    rows.push(row);
  }
  return { turn: s.turn, status: result(s), rows, pieces, moves: s.history };
}

/** One game with the three typed actions. `move` throws nothing: it returns `{ ok: false, code, error }`. */
export class ChessGame {
  state: State = newGame();
  get_board(): BoardView { return view(this.state); }
  legal_moves(from?: string): { from: Square; to: Square; promotion?: Promotion }[] {
    return legalMoves(this.state, from);
  }
  move(from: string, to: string, promotion?: Promotion): MoveOk | ActionError {
    try {
      this.state = move(this.state, from, to, promotion);
      return { ok: true, move: this.state.history[this.state.history.length - 1]!, board: view(this.state) };
    } catch (e) {
      if (e instanceof IllegalMove) return { ok: false, code: e.code, error: e.message };
      throw e;
    }
  }
  reset(): void { this.state = newGame(); }
}
