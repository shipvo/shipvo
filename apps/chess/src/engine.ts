// Pure chess rules engine. No UI, no I/O.
//
// Squares are numbers 0..63: index = rank * 8 + file, a1 = 0, h8 = 63.
//
// Draw rules:
// - 75-move rule: AUTOMATIC. After 75 moves by each side (150 half-moves)
//   with no pawn move or capture, the game is drawn at once, unless that
//   last move gave checkmate.
// - 50-move rule: CLAIMABLE. After 50 moves by each side (100 half-moves)
//   with no pawn move or capture, the player to move may claim a draw.
// - Fivefold repetition is automatic; threefold repetition is claimable.
// - Insufficient material is automatic.

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface Piece {
  color: Color;
  type: PieceType;
}
export type Square = number;
export type Promotion = "q" | "r" | "b" | "n";

export interface Castling {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface Position {
  board: (Piece | null)[];
  turn: Color;
  castling: Castling;
  /** En passant target square (the square behind a pawn that just moved two). */
  ep: Square | null;
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: Square;
  to: Square;
  promotion?: Promotion;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";
const PIECE_NAMES: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

// ---------- naming helpers ----------

export function squareName(sq: Square): string {
  return FILES[sq & 7] + String((sq >> 3) + 1);
}

export function parseSquare(name: string): Square {
  if (!/^[a-h][1-8]$/.test(name)) throw new Error(`Bad square: ${name}`);
  return (Number(name[1]) - 1) * 8 + FILES.indexOf(name[0]);
}

export function pieceName(p: Piece): string {
  return `${p.color === "w" ? "white" : "black"} ${PIECE_NAMES[p.type]}`;
}

/** "white knight on g1" */
export function describePieceAt(pos: Position, sq: Square): string {
  const p = pos.board[sq];
  return p ? `${pieceName(p)} on ${squareName(sq)}` : `empty square ${squareName(sq)}`;
}

export function moveToUci(m: Move): string {
  return squareName(m.from) + squareName(m.to) + (m.promotion ?? "");
}

export function parseUci(s: string): Move {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(s);
  if (!m) throw new Error(`Bad move: ${s}`);
  return { from: parseSquare(m[1]), to: parseSquare(m[2]), ...(m[3] ? { promotion: m[3] as Promotion } : {}) };
}

/** "white knight from g1 to f3" */
export function describeMove(pos: Position, m: Move): string {
  const p = pos.board[m.from];
  if (!p) return moveToUci(m);
  const cap = pos.board[m.to] ?? (p.type === "p" && m.to === pos.ep ? { color: opposite(p.color), type: "p" as const } : null);
  let s = `${pieceName(p)} from ${squareName(m.from)} to ${squareName(m.to)}`;
  if (cap) s += ` capturing ${pieceName(cap)}`;
  if (m.promotion) s += ` promoting to ${PIECE_NAMES[m.promotion]}`;
  return s;
}

// ---------- FEN ----------

export function opposite(c: Color): Color {
  return c === "w" ? "b" : "w";
}

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error("Bad FEN");
  const rows = parts[0].split("/");
  if (rows.length !== 8) throw new Error("Bad FEN board");
  const board: (Piece | null)[] = new Array(64).fill(null);
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else {
        const type = ch.toLowerCase() as PieceType;
        if (!"pnbrqk".includes(type) || file > 7) throw new Error("Bad FEN piece");
        board[rank * 8 + file++] = { color: ch === ch.toLowerCase() ? "b" : "w", type };
      }
    }
    if (file !== 8) throw new Error("Bad FEN row");
  });
  if (parts[1] !== "w" && parts[1] !== "b") throw new Error("Bad FEN turn");
  const c = parts[2];
  return {
    board,
    turn: parts[1],
    castling: { wK: c.includes("K"), wQ: c.includes("Q"), bK: c.includes("k"), bQ: c.includes("q") },
    ep: parts[3] === "-" ? null : parseSquare(parts[3]),
    halfmove: Number(parts[4] ?? 0),
    fullmove: Number(parts[5] ?? 1),
  };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 8 + file];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p.color === "w" ? p.type.toUpperCase() : p.type;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return [rows.join("/"), pos.turn, castlingString(pos.castling), pos.ep === null ? "-" : squareName(pos.ep), pos.halfmove, pos.fullmove].join(" ");
}

function castlingString(c: Castling): string {
  return (c.wK ? "K" : "") + (c.wQ ? "Q" : "") + (c.bK ? "k" : "") + (c.bQ ? "q" : "") || "-";
}

export function startPosition(): Position {
  return parseFen(START_FEN);
}

// ---------- attacks ----------

const KNIGHT: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function at(file: number, rank: number): Square | -1 {
  return file < 0 || file > 7 || rank < 0 || rank > 7 ? -1 : rank * 8 + file;
}

/** Is `sq` attacked by any piece of color `by`? */
export function isAttacked(pos: Position, sq: Square, by: Color): boolean {
  const f = sq & 7;
  const r = sq >> 3;
  const b = pos.board;
  // pawns: a white pawn attacks upward, so it sits one rank below the target
  const pr = by === "w" ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const s = at(f + df, pr);
    if (s >= 0 && b[s]?.color === by && b[s]?.type === "p") return true;
  }
  for (const [df, dr] of KNIGHT) {
    const s = at(f + df, r + dr);
    if (s >= 0 && b[s]?.color === by && b[s]?.type === "n") return true;
  }
  for (const [df, dr] of KING) {
    const s = at(f + df, r + dr);
    if (s >= 0 && b[s]?.color === by && b[s]?.type === "k") return true;
  }
  for (const [dirs, types] of [[DIAG, "bq"], [ORTHO, "rq"]] as const) {
    for (const [df, dr] of dirs) {
      let x = f + df;
      let y = r + dr;
      while (at(x, y) >= 0) {
        const p = b[y * 8 + x];
        if (p) {
          if (p.color === by && types.includes(p.type)) return true;
          break;
        }
        x += df;
        y += dr;
      }
    }
  }
  return false;
}

function findKing(pos: Position, color: Color): Square {
  return pos.board.findIndex((p) => p?.type === "k" && p.color === color);
}

export function isInCheck(pos: Position, color: Color = pos.turn): boolean {
  const k = findKing(pos, color);
  return k >= 0 && isAttacked(pos, k, opposite(color));
}

// ---------- move generation ----------

function pseudoMoves(pos: Position): Move[] {
  const out: Move[] = [];
  const us = pos.turn;
  const them = opposite(us);
  const b = pos.board;
  const add = (from: Square, to: Square) => out.push({ from, to });
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (!p || p.color !== us) continue;
    const f = from & 7;
    const r = from >> 3;
    if (p.type === "p") {
      const dir = us === "w" ? 1 : -1;
      const start = us === "w" ? 1 : 6;
      const last = us === "w" ? 7 : 0;
      const push = (to: Square) => {
        if (to >> 3 === last) for (const promotion of ["q", "r", "b", "n"] as const) out.push({ from, to, promotion });
        else add(from, to);
      };
      const one = at(f, r + dir);
      if (one >= 0 && !b[one]) {
        push(one);
        const two = at(f, r + 2 * dir);
        if (r === start && !b[two]) add(from, two);
      }
      for (const df of [-1, 1]) {
        const to = at(f + df, r + dir);
        if (to < 0) continue;
        if (b[to] && b[to]!.color === them) push(to);
        else if (!b[to] && to === pos.ep) add(from, to);
      }
    } else if (p.type === "n" || p.type === "k") {
      for (const [df, dr] of p.type === "n" ? KNIGHT : KING) {
        const to = at(f + df, r + dr);
        if (to >= 0 && b[to]?.color !== us) add(from, to);
      }
      if (p.type === "k") castlingMoves(pos, from, out);
    } else {
      const dirs = p.type === "b" ? DIAG : p.type === "r" ? ORTHO : [...DIAG, ...ORTHO];
      for (const [df, dr] of dirs) {
        let x = f + df;
        let y = r + dr;
        while (at(x, y) >= 0) {
          const to = y * 8 + x;
          if (b[to]) {
            if (b[to]!.color !== us) add(from, to);
            break;
          }
          add(from, to);
          x += df;
          y += dr;
        }
      }
    }
  }
  return out;
}

function castlingMoves(pos: Position, from: Square, out: Move[]): void {
  const us = pos.turn;
  const home = us === "w" ? 4 : 60;
  if (from !== home) return;
  const them = opposite(us);
  const b = pos.board;
  const rights = us === "w" ? [pos.castling.wK, pos.castling.wQ] : [pos.castling.bK, pos.castling.bQ];
  if (!rights[0] && !rights[1]) return;
  if (isAttacked(pos, home, them)) return; // cannot castle out of check
  const rook = (sq: Square) => b[sq]?.type === "r" && b[sq]?.color === us;
  // king side: f and g empty and not attacked
  if (rights[0] && rook(home + 3) && !b[home + 1] && !b[home + 2] && !isAttacked(pos, home + 1, them) && !isAttacked(pos, home + 2, them)) {
    out.push({ from, to: home + 2 });
  }
  // queen side: b, c, d empty; c and d not attacked (b may be attacked)
  if (rights[1] && rook(home - 4) && !b[home - 1] && !b[home - 2] && !b[home - 3] && !isAttacked(pos, home - 1, them) && !isAttacked(pos, home - 2, them)) {
    out.push({ from, to: home - 2 });
  }
}

/** Play a move without checking legality. */
export function applyMove(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const piece = board[m.from]!;
  const captured = board[m.to];
  const us = pos.turn;
  board[m.to] = m.promotion ? { color: us, type: m.promotion } : piece;
  board[m.from] = null;
  if (piece.type === "p" && m.to === pos.ep && !captured && (m.from & 7) !== (m.to & 7)) {
    board[m.to + (us === "w" ? -8 : 8)] = null; // en passant capture
  }
  if (piece.type === "k" && Math.abs(m.to - m.from) === 2) {
    const kingSide = m.to > m.from;
    const rookFrom = kingSide ? m.from + 3 : m.from - 4;
    const rookTo = kingSide ? m.from + 1 : m.from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  const castling = { ...pos.castling };
  if (piece.type === "k") {
    if (us === "w") castling.wK = castling.wQ = false;
    else castling.bK = castling.bQ = false;
  }
  for (const sq of [m.from, m.to]) {
    if (sq === 0) castling.wQ = false;
    if (sq === 7) castling.wK = false;
    if (sq === 56) castling.bQ = false;
    if (sq === 63) castling.bK = false;
  }
  const double = piece.type === "p" && Math.abs(m.to - m.from) === 16;
  return {
    board,
    turn: opposite(us),
    castling,
    ep: double ? (m.from + m.to) / 2 : null,
    halfmove: piece.type === "p" || captured ? 0 : pos.halfmove + 1,
    fullmove: pos.fullmove + (us === "b" ? 1 : 0),
  };
}

export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((m) => !isInCheck(applyMove(pos, m), pos.turn));
}

/** Find the legal move matching from/to (and promotion; defaults to queen). */
export function findLegalMove(pos: Position, m: Move): Move | undefined {
  const promo = m.promotion;
  return legalMoves(pos).find(
    (x) => x.from === m.from && x.to === m.to && (x.promotion ? x.promotion === (promo ?? "q") : !promo),
  );
}

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(applyMove(pos, m), depth - 1);
  return n;
}

// ---------- repetition key ----------

/**
 * Position identity for repetition: pieces, side to move, castling rights and
 * the en passant square. The en passant square only counts when a legal en
 * passant capture exists, as in FIDE rules.
 */
export function repetitionKey(pos: Position): string {
  let ep = "-";
  if (pos.ep !== null) {
    const canCapture = legalMoves(pos).some(
      (m) => m.to === pos.ep && pos.board[m.from]?.type === "p" && (m.from & 7) !== (m.to & 7),
    );
    if (canCapture) ep = squareName(pos.ep);
  }
  const fen = toFen(pos).split(" ");
  return `${fen[0]} ${fen[1]} ${fen[2]} ${ep}`;
}

// ---------- game state ----------

export function hasInsufficientMaterial(pos: Position): boolean {
  const minors: { type: PieceType; sq: number; color: Color }[] = [];
  pos.board.forEach((p, sq) => {
    if (!p || p.type === "k") return;
    if (p.type === "p" || p.type === "r" || p.type === "q") minors.push({ type: "q", sq, color: p.color });
    else minors.push({ type: p.type, sq, color: p.color });
  });
  if (minors.some((x) => x.type === "q")) return false;
  if (minors.length <= 1) return true;
  // only bishops, all on the same square colour
  if (minors.every((x) => x.type === "b")) {
    const shade = (sq: number) => ((sq >> 3) + (sq & 7)) % 2;
    return minors.every((x) => shade(x.sq) === shade(minors[0].sq));
  }
  return false;
}

export type GameStatus =
  | { state: "playing"; check: boolean }
  | { state: "checkmate"; winner: Color }
  | { state: "draw"; reason: "stalemate" | "insufficient-material" | "seventy-five-move" | "fivefold-repetition" };

export interface Claims {
  /** The player to move may claim a draw by the 50-move rule. */
  fiftyMove: boolean;
  /** The player to move may claim a draw by threefold repetition. */
  threefold: boolean;
}

export class Game {
  position: Position;
  private keys: string[];
  readonly moves: Move[] = [];
  private claimed = false;

  constructor(start: Position = startPosition()) {
    this.position = start;
    this.keys = [repetitionKey(start)];
  }

  legalMoves(): Move[] {
    return legalMoves(this.position);
  }

  /** Play a legal move. Throws if it is illegal or the game is over. */
  play(m: Move | string): Move {
    const move = typeof m === "string" ? parseUci(m) : m;
    if (this.status().state !== "playing" || this.claimed) throw new Error("Game is over");
    const legal = findLegalMove(this.position, move);
    if (!legal) throw new Error(`Illegal move: ${moveToUci(move)}`);
    this.position = applyMove(this.position, legal);
    this.keys.push(repetitionKey(this.position));
    this.moves.push(legal);
    return legal;
  }

  repetitions(): number {
    const k = this.keys[this.keys.length - 1];
    return this.keys.filter((x) => x === k).length;
  }

  status(): GameStatus {
    const pos = this.position;
    const check = isInCheck(pos);
    if (legalMoves(pos).length === 0) {
      return check ? { state: "checkmate", winner: opposite(pos.turn) } : { state: "draw", reason: "stalemate" };
    }
    if (hasInsufficientMaterial(pos)) return { state: "draw", reason: "insufficient-material" };
    if (this.repetitions() >= 5) return { state: "draw", reason: "fivefold-repetition" };
    if (pos.halfmove >= 150) return { state: "draw", reason: "seventy-five-move" };
    return { state: "playing", check };
  }

  claims(): Claims {
    return { fiftyMove: this.position.halfmove >= 100, threefold: this.repetitions() >= 3 };
  }

  /** Claim a draw. Returns false when no claim is available. */
  claimDraw(): boolean {
    const c = this.claims();
    if (this.status().state !== "playing" || !(c.fiftyMove || c.threefold)) return false;
    this.claimed = true;
    return true;
  }

  get drawClaimed(): boolean {
    return this.claimed;
  }
}
