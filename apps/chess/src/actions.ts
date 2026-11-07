// Typed actions for agents. They read and write the same store as the UI.
import {
  describeMove,
  isInCheck,
  moveToUci,
  parseSquare,
  squareName,
  toFen,
  type Promotion,
} from "./engine.js";
import { chessStore, type ChessStore } from "./store.js";
import { boardView, moveList } from "./view.js";

export interface BoardState {
  fen: string;
  turn: "white" | "black";
  status: string;
  squares: { square: string; label: string }[];
  moves: string[];
}

export interface LegalMove {
  from: string;
  to: string;
  promotion?: Promotion;
  uci: string;
  description: string;
}

export type MoveResult =
  | { ok: true; move: string; description: string; board: BoardState }
  | { ok: false; reason: string };

export interface MoveInput {
  from: string;
  to: string;
  promotion?: Promotion;
}

export function createActions(store: ChessStore = chessStore) {
  const getBoard = (): BoardState => {
    const g = store.game;
    const s = g.status();
    const status =
      s.state === "playing" ? (s.check ? "check" : "playing") : s.state === "checkmate" ? `checkmate, ${s.winner === "w" ? "white" : "black"} wins` : `draw by ${s.reason}`;
    return {
      fen: toFen(g.position),
      turn: g.position.turn === "w" ? "white" : "black",
      status,
      squares: boardView(g).map((q) => ({ square: q.name, label: q.label })),
      moves: moveList(g),
    };
  };

  return {
    get_board: getBoard,

    /** Legal moves for the side to move, optionally only from one square. */
    legal_moves(input: { from?: string } = {}): LegalMove[] {
      let from: number | undefined;
      if (input.from !== undefined) {
        try {
          from = parseSquare(input.from);
        } catch {
          return [];
        }
      }
      const g = store.game;
      return g
        .legalMoves()
        .filter((m) => from === undefined || m.from === from)
        .map((m) => ({
          from: squareName(m.from),
          to: squareName(m.to),
          ...(m.promotion ? { promotion: m.promotion } : {}),
          uci: moveToUci(m),
          description: describeMove(g.position, m),
        }));
    },

    move(input: MoveInput): MoveResult {
      const g = store.game;
      if (g.status().state !== "playing" || g.drawClaimed) return { ok: false, reason: "The game is over." };
      let from: number;
      let to: number;
      try {
        from = parseSquare(input.from);
        to = parseSquare(input.to);
      } catch {
        return { ok: false, reason: `Bad square. Use names like e2 and e4 (got ${input.from} and ${input.to}).` };
      }
      const piece = g.position.board[from];
      if (!piece) return { ok: false, reason: `There is no piece on ${input.from}.` };
      const turn = g.position.turn;
      if (piece.color !== turn) {
        return { ok: false, reason: `It is ${turn === "w" ? "white" : "black"}'s turn, and the piece on ${input.from} is ${piece.color === "w" ? "white" : "black"}.` };
      }
      const candidates = g.legalMoves().filter((m) => m.from === from && m.to === to);
      if (candidates.length === 0) {
        const why = isInCheck(g.position) ? "Your king is in check and this move does not get out of it." : `That ${piece.type === "p" ? "pawn" : "piece"} cannot move from ${input.from} to ${input.to}, or the move would leave your king in check.`;
        return { ok: false, reason: why };
      }
      let chosen = candidates[0];
      if (candidates.length > 1) {
        const promo = input.promotion;
        const match = candidates.find((m) => m.promotion === promo);
        if (!match) return { ok: false, reason: "This move promotes a pawn. Pass promotion: q, r, b or n." };
        chosen = match;
      }
      const description = describeMove(g.position, chosen);
      store.play(chosen);
      return { ok: true, move: moveToUci(chosen), description, board: getBoard() };
    },
  };
}

export const chessActions = createActions();
