import { applyMove, isInCheck, legalMoves, squareName, type Move, type Position } from "./engine.js";

/** Standard algebraic notation for a legal move in `pos`, e.g. "Nf3", "exd5", "O-O", "Qh4#". */
export function toSan(pos: Position, m: Move): string {
  const piece = pos.board[m.from];
  if (!piece) return squareName(m.from) + squareName(m.to);
  const capture = pos.board[m.to] !== null || (piece.type === "p" && m.to === pos.ep);
  let s: string;
  if (piece.type === "k" && Math.abs((m.to & 7) - (m.from & 7)) === 2) {
    s = (m.to & 7) > (m.from & 7) ? "O-O" : "O-O-O";
  } else if (piece.type === "p") {
    s = (capture ? squareName(m.from)[0] + "x" : "") + squareName(m.to) + (m.promotion ? "=" + m.promotion.toUpperCase() : "");
  } else {
    const same = legalMoves(pos).filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from]?.type === piece.type);
    let from = "";
    if (same.length) {
      const file = same.every((o) => (o.from & 7) !== (m.from & 7));
      const rank = same.every((o) => (o.from >> 3) !== (m.from >> 3));
      const name = squareName(m.from);
      from = file ? name[0] : rank ? name[1] : name;
    }
    s = piece.type.toUpperCase() + from + (capture ? "x" : "") + squareName(m.to);
  }
  const next = applyMove(pos, m);
  if (isInCheck(next)) s += legalMoves(next).length === 0 ? "#" : "+";
  return s;
}
