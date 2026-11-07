import {
  Game, describePieceAt, moveToUci, parseSquare, squareName, toFen, describeMove,
  type GameStatus, type Promotion,
} from "./engine.js";
import { toSan } from "./san.js";

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
  /** The last move in UCI, or null before the first move. */
  lastMove: string | null;
  /** The side that lost on the move clock, or null. */
  timeLoss: "white" | "black" | null;
  /** True when the game has ended: checkmate, a draw, a claimed draw or a lost clock. */
  over: boolean;
  /** "Checkmate, white wins", "Time out, black wins", a draw text, or null while the game is on. */
  result: string | null;
  /** The side this phone plays, when the page assigned one. */
  seat: "white" | "black" | null;
}

export function resultText(status: GameStatus, timeLoss: "white" | "black" | null = null): string | null {
  if (timeLoss) return `Time out, ${timeLoss === "white" ? "black" : "white"} wins`;
  if (status.state === "checkmate") return `Checkmate, ${status.winner === "w" ? "white" : "black"} wins`;
  if (status.state === "draw") return status.reason === "stalemate" ? "Stalemate, draw" : `Draw (${status.reason})`;
  return null;
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
  private san: string[] = [];
  private seat: "white" | "black" | null = null;
  private timeLoss: "white" | "black" | null = null;
  private notice = "";

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
    const status = this.game.status();
    const moves = this.game.moves.map(moveToUci);
    return {
      fen: toFen(pos),
      turn: pos.turn === "w" ? "white" : "black",
      status,
      squares,
      moves,
      lastMove: moves.at(-1) ?? null,
      timeLoss: this.timeLoss,
      over: this.isOver(),
      result: resultText(status, this.timeLoss) ?? (this.game.drawClaimed ? "Draw (claimed)" : null),
      seat: this.seat,
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

  move(from: string, to: string, promotion?: Promotion, opts: { relay?: boolean } = {}): MoveResult {
    const reject = (reason: string): MoveResult => ({ ok: false, reason, board: this.get_board() });
    let f: number, t: number;
    try { f = parseSquare(from); t = parseSquare(to); } catch (e) { return reject((e as Error).message); }
    if (this.isOver()) return reject("The game is over");
    const pos = this.game.position;
    if (!opts.relay) {
      const wait = this.outOfTurn();
      if (wait) return this.refuse(wait);
    }
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
    const san = toSan(pos, chosen);
    const played = this.game.play(chosen);
    this.san.push(san);
    this.notice = "";
    this.descriptions.push(text);
    this.emit();
    return { ok: true, move: moveToUci(played), board: this.get_board() };
  }

  // ----- seats, turn order and the move clock -----

  /** Which side this phone plays. With a seat, a move out of turn is refused. `null` plays both sides. */
  setSeat(seat: "white" | "black" | null) { this.seat = seat; this.emit(); }

  /** The refusal for a move made out of turn, or null when it is this phone's turn (or it has no seat). */
  outOfTurn(): string | null {
    if (!this.seat || this.isOver()) return null;
    const turn = this.game.position.turn === "w" ? "white" : "black";
    return turn === this.seat ? null : `It is ${turn}'s turn. You play ${this.seat}. Wait for your turn, then call get_board again.`;
  }

  /** Records a refusal so the screen shows it, and returns it as a failed move. */
  refuse(reason: string): MoveResult {
    this.notice = reason;
    this.emit();
    return { ok: false, reason, board: this.get_board() };
  }

  /** The move clock of `loser` ran out. Ends the game. */
  timeout(loser: "white" | "black") {
    if (this.isOver()) return;
    this.timeLoss = loser;
    this.notice = "";
    this.emit();
  }

  /** The last refusal, shown on screen until the next move is played. */
  lastNotice(): string { return this.notice; }

  /** Moves so far in standard algebraic notation, e.g. "e4", "Nf3", "Qh4#". */
  sanMoves(): string[] { return [...this.san]; }

  private isOver(): boolean {
    return this.timeLoss !== null || this.game.status().state !== "playing" || this.game.drawClaimed;
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
