import type { ChessStore } from "./state.js";
import { createActions, type BoardSquare } from "./state.js";

export interface MoveListRow {
  number: number;
  white: string;
  black?: string;
  label: string;
}

export interface ChessView {
  squares: BoardSquare[];
  moveList: MoveListRow[];
  turn: string;
}

/** What the screen renders. Read from the shared store on every call, so it never goes stale. */
export function viewOf(store: ChessStore): ChessView {
  const b = createActions(store).get_board();
  const moveList: MoveListRow[] = [];
  for (let i = 0; i < b.moves.length; i += 2) {
    const white = b.moves[i];
    const black = b.moves[i + 1];
    moveList.push({ number: i / 2 + 1, white, black, label: `Move ${i / 2 + 1}: ${white}${black ? `, ${black}` : ""}` });
  }
  return { squares: b.squares, moveList, turn: b.turn };
}
