import { ChessGame } from "./actions";
import { name, type Square } from "./engine";

export type Tap = { from: Square | null; note: string | null; moved: boolean };

/** One tap on a square: select a piece, move it (promotes to queen), or explain why not. */
export function tapSquare(game: ChessGame, from: Square | null, at: Square): Tap {
  const piece = game.state.board[at];
  if (from && game.legal_moves(from).some((m) => m.to === at)) {
    const r = game.move(from, at, "queen");
    return { from: null, note: r.ok ? r.move.text : r.error, moved: r.ok };
  }
  if (piece && piece.color === game.state.turn) {
    return { from: at, note: `${name(piece)} on ${at} selected. ${game.legal_moves(at).length} moves.`, moved: false };
  }
  return { from: null, note: piece ? `It is ${game.state.turn}'s turn.` : "Pick a piece first.", moved: false };
}

/** Turn, check and result only. The move timer is a separate element. */
export function statusText(game: ChessGame): string {
  const st = game.get_board().status;
  if (st.status === "checkmate") return `Checkmate. ${st.winner} wins.`;
  if (st.status === "stalemate" || st.status === "draw") return `Draw: ${st.reason}.`;
  return `${game.state.turn} to move${st.status === "check" ? ", in check" : ""}.`;
}
