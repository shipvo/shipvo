import {
  Game, describePieceAt, moveToUci, parseSquare, squareName, toFen, describeMove,
  type GameStatus, type Promotion,
} from "./engine.js";

/**
 * One shared game. The UI and the typed actions both go through this store,
 * so a move made by either one shows up in the other.
 */
export interface BoardSquare {
  square: string;
  /** "white knight on g1" or "empty square e4" */
  label: string;
  piece: string | null;
  dark: boolean;
}

export interface BoardSnapshot {
  fen: string;
  turn: "white" | "black";
  status: GameStatus;
  /** Rank 8 first, files a to h: the order the board is drawn. */
  squares: BoardSquare[];
  /** Moves played so far in UCI, e.g. "e2e4". */
  moves: string[];
}

export interface LegalMove { from: string; to: string; promotion?: Promotion; description: string }

export type MoveResult =
  | { ok: true; move: string; board: BoardSnapshot }
  | { ok: false; reason: string; board: BoardSnapshot };

export interface MoveListRow { number: number; white: string; black: string | null }

export class ChessStore {
  private game = new Game();
  private listeners = new Set<() => void>();
  private descriptions: string[] = [];

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ----- typed actions -----

  get_board(): BoardSnapshot {
    const pos = this.game.position;
    const squares: BoardSquare[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const sq = rank * 8 + file;
        const p = pos.board[sq];
        squares.push({
          square: squareName(sq),
          label: describePieceAt(pos, sq),
          piece: p ? p.color + p.type : null,
          dark: (rank + file) % 2 === 0,
        });
      }
    }
    return {
      fen: toFen(pos),
      turn: pos.turn === "w" ? "white" : "black",
      status: this.game.status(),
      squares,
      moves: this.game.moves.map(moveToUci),
    };
  }

  /** Legal moves for the side to move, optionally only from one square. */
  legal_moves(from?: string): LegalMove[] {
    const pos = this.game.position;
    let want: number | undefined;
    if (from !== undefined) {
      try { want = parseSquare(from); } catch { return []; }
    }
    return this.game.legalMoves()
      .filter((m) => want === undefined || m.from === want)
      .map((m) => ({
        from: squareName(m.from),
        to: squareName(m.to),
        ...(m.promotion ? { promotion: m.promotion } : {}),
        description: describeMove(pos, m),
      }));
  }

  move(from: string, to: string, promotion?: Promotion): MoveResult {
    const reject = (reason: string): MoveResult => ({ ok: false, reason, board: this.get_board() });
    let f: number, t: number;
    try { f = parseSquare(from); t = parseSquare(to); } catch (e) { return reject((e as Error).message); }
    const status = this.game.status();
    if (status.state !== "playing" || this.game.drawClaimed) return reject("The game is over");
    const pos = this.game.position;
    const piece = pos.board[f];
    if (!piece) return reject(`No piece on ${from}`);
    if (piece.color !== pos.turn) {
      return reject(`It is ${pos.turn === "w" ? "white" : "black"}'s turn; ${describePieceAt(pos, f)} cannot move`);
    }
    const candidates = this.game.legalMoves().filter((m) => m.from === f && m.to === t);
    if (candidates.length === 0) return reject(`Illegal move: ${describePieceAt(pos, f)} cannot go to ${to}`);
    if (candidates.length > 1 && !promotion) return reject(`Promotion needed: choose q, r, b or n`);
    const chosen = candidates.find((m) => (m.promotion ?? undefined) === promotion);
    if (!chosen) return reject(`Illegal promotion: ${promotion ?? "none"}`);
    const text = describeMove(pos, chosen);
    const played = this.game.play(chosen);
    this.descriptions.push(text);
    this.emit();
    return { ok: true, move: moveToUci(played), board: this.get_board() };
  }

  // ----- what the UI reads -----

  /** Move list, one row per full move. */
  moveList(): MoveListRow[] {
    const uci = this.game.moves.map(moveToUci);
    const rows: MoveListRow[] = [];
    for (let i = 0; i < uci.length; i += 2) {
      rows.push({ number: i / 2 + 1, white: uci[i], black: uci[i + 1] ?? null });
    }
    return rows;
  }

  /** Spoken descriptions of each move, for screen readers. */
  moveDescriptions(): string[] {
    return [...this.descriptions];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
