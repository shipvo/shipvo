import { Game, describeMove, describePieceAt, moveToUci, parseSquare, squareName, toFen, type GameStatus } from "./engine.js";

/** One game, shared by the UI and the typed actions. Both read and write this store. */
export interface ChessStore {
  readonly game: Game;
  /** Moves as text, e.g. "white pawn from e2 to e4". Same order as game.moves. */
  readonly log: string[];
  subscribe(fn: () => void): () => void;
  /** Call after any change to the game. */
  notify(): void;
}

export function createChessStore(game: Game = new Game()): ChessStore {
  const listeners = new Set<() => void>();
  return {
    game,
    log: [],
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    notify() {
      for (const fn of [...listeners]) fn();
    },
  };
}

export interface BoardSquare {
  name: string;
  /** "white knight on g1" or "empty square e4" */
  label: string;
  piece: string | null;
}

export type MoveResult =
  | { ok: true; move: string; description: string; status: GameStatus; fen: string }
  | { ok: false; reason: string };

/** Typed actions. `move` goes through the same store the UI renders. */
export function createActions(store: ChessStore) {
  const { game } = store;
  const board = (): BoardSquare[] => {
    const out: BoardSquare[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const sq = rank * 8 + file;
        const p = game.position.board[sq];
        out.push({ name: squareName(sq), label: describePieceAt(game.position, sq), piece: p ? p.color + p.type : null });
      }
    }
    return out;
  };
  return {
    get_board() {
      return { squares: board(), turn: game.position.turn, fen: toFen(game.position), status: game.status(), moves: [...store.log] };
    },
    legal_moves(from?: string) {
      let fromSq: number | undefined;
      if (from !== undefined) {
        try {
          fromSq = parseSquare(from);
        } catch {
          return [];
        }
      }
      return game.legalMoves().filter((m) => fromSq === undefined || m.from === fromSq).map(moveToUci);
    },
    move(from: string, to: string, promotion?: "q" | "r" | "b" | "n"): MoveResult {
      let uci: string;
      try {
        uci = squareName(parseSquare(from)) + squareName(parseSquare(to)) + (promotion ?? "");
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
      if (game.status().state !== "playing" || game.drawClaimed) return { ok: false, reason: "Game is over" };
      const p = game.position;
      if (!p.board[parseSquare(from)]) return { ok: false, reason: `No piece on ${from}` };
      if (p.board[parseSquare(from)]!.color !== p.turn) {
        return { ok: false, reason: `It is ${p.turn === "w" ? "white" : "black"}'s turn` };
      }
      const wanted = game.legalMoves().filter((m) => m.from === parseSquare(from) && m.to === parseSquare(to));
      if (wanted.length > 1 && !promotion) return { ok: false, reason: "Promotion needed: pass q, r, b or n" };
      const description = wanted.length ? describeMove(p, { from: parseSquare(from), to: parseSquare(to), promotion }) : "";
      try {
        const played = game.play(uci);
        store.log.push(description || moveToUci(played));
      } catch {
        return { ok: false, reason: `Illegal move: ${from} to ${to}` };
      }
      store.notify();
      return { ok: true, move: uci, description, status: game.status(), fen: toFen(game.position) };
    },
  };
}

export type ChessActions = ReturnType<typeof createActions>;
