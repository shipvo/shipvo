// A small, dependency-free chess engine: legal moves, check, mate, stalemate, labels.
export type Color = "white" | "black";
export type Kind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type Piece = { color: Color; kind: Kind };
export type Square = string; // "a1".."h8"
export type Board = Record<Square, Piece>;
export type Promotion = "queen" | "rook" | "bishop" | "knight";
export type State = {
  board: Board;
  turn: Color;
  castling: { white: { k: boolean; q: boolean }; black: { k: boolean; q: boolean } };
  enPassant: Square | null;
  halfmove: number;
  history: MoveRecord[];
  positions: string[];
};
export type MoveRecord = { n: number; color: Color; from: Square; to: Square; san: string; text: string };
export type Result = { status: "playing" | "check" | "checkmate" | "stalemate" | "draw"; winner?: Color; reason?: string };

const FILES = "abcdefgh";
const LETTER: Record<Kind, string> = { pawn: "", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };
const FEN_LETTER: Record<Kind, string> = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
export const other = (c: Color): Color => (c === "white" ? "black" : "white");
export const sq = (f: number, r: number): Square => FILES[f]! + (r + 1);
const fileOf = (s: Square) => FILES.indexOf(s[0]!);
const rankOf = (s: Square) => Number(s[1]) - 1;
const inside = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
export const isSquare = (s: unknown): s is Square => typeof s === "string" && /^[a-h][1-8]$/.test(s);

export function newGame(): State {
  const board: Board = {};
  const back: Kind[] = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
  for (let f = 0; f < 8; f++) {
    board[sq(f, 0)] = { color: "white", kind: back[f]! };
    board[sq(f, 1)] = { color: "white", kind: "pawn" };
    board[sq(f, 6)] = { color: "black", kind: "pawn" };
    board[sq(f, 7)] = { color: "black", kind: back[f]! };
  }
  const s: State = { board, turn: "white", castling: { white: { k: true, q: true }, black: { k: true, q: true } }, enPassant: null, halfmove: 0, history: [], positions: [] };
  s.positions.push(key(s));
  return s;
}

/** A state from a piece map, for tests and puzzles. */
export function fromPieces(pieces: Record<Square, string>, turn: Color = "white", enPassant: Square | null = null): State {
  const board: Board = {};
  const kinds: Record<string, Kind> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  for (const [s, p] of Object.entries(pieces)) board[s] = { color: p === p.toUpperCase() ? "white" : "black", kind: kinds[p.toLowerCase()]! };
  const st: State = { board, turn, castling: { white: { k: false, q: false }, black: { k: false, q: false } }, enPassant, halfmove: 0, history: [], positions: [] };
  st.positions.push(key(st));
  return st;
}

function key(s: State): string {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    for (let f = 0; f < 8; f++) {
      const p = s.board[sq(f, r)];
      row += p ? (p.color === "white" ? FEN_LETTER[p.kind].toUpperCase() : FEN_LETTER[p.kind]) : ".";
    }
    rows.push(row);
  }
  const c = s.castling;
  return `${rows.join("/")} ${s.turn[0]} ${c.white.k ? "K" : ""}${c.white.q ? "Q" : ""}${c.black.k ? "k" : ""}${c.black.q ? "q" : ""} ${s.enPassant ?? "-"}`;
}

export function name(p: Piece | undefined): string { return p ? `${p.color} ${p.kind}` : "empty"; }
/** The label an assistant reads: "e4, white pawn" or "e5, empty". */
export function squareLabel(s: State, at: Square): string { return `${at}, ${name(s.board[at])}`; }

function attacked(board: Board, at: Square, by: Color): boolean {
  const f = fileOf(at), r = rankOf(at);
  const dir = by === "white" ? 1 : -1;
  for (const df of [-1, 1]) { const p = board[sq(f + df, r - dir)]; if (inside(f + df, r - dir) && p?.color === by && p.kind === "pawn") return true; }
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] as const) {
    if (inside(f + df, r + dr) && board[sq(f + df, r + dr)]?.color === by && board[sq(f + df, r + dr)]!.kind === "knight") return true;
  }
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if ((df || dr) && inside(f + df, r + dr)) { const p = board[sq(f + df, r + dr)]; if (p?.color === by && p.kind === "king") return true; }
  }
  for (const [df, dr, kinds] of [[1, 0, "rook"], [-1, 0, "rook"], [0, 1, "rook"], [0, -1, "rook"], [1, 1, "bishop"], [1, -1, "bishop"], [-1, 1, "bishop"], [-1, -1, "bishop"]] as const) {
    let x = f + df, y = r + dr;
    while (inside(x, y)) {
      const p = board[sq(x, y)];
      if (p) { if (p.color === by && (p.kind === kinds || p.kind === "queen")) return true; break; }
      x += df; y += dr;
    }
  }
  return false;
}

function kingSquare(board: Board, c: Color): Square | undefined {
  return Object.keys(board).find((s) => board[s]!.color === c && board[s]!.kind === "king");
}
export const inCheck = (s: State, c: Color = s.turn): boolean => { const k = kingSquare(s.board, c); return !!k && attacked(s.board, k, other(c)); };

type Raw = { from: Square; to: Square; promotion?: Promotion; ep?: boolean; castle?: "k" | "q" };

function pseudo(s: State, from: Square): Raw[] {
  const p = s.board[from];
  if (!p || p.color !== s.turn) return [];
  const f = fileOf(from), r = rankOf(from), out: Raw[] = [];
  const push = (x: number, y: number) => { if (inside(x, y) && s.board[sq(x, y)]?.color !== p.color) out.push({ from, to: sq(x, y) }); };
  const slide = (dirs: number[][]) => {
    for (const [df, dr] of dirs) {
      let x = f + df!, y = r + dr!;
      while (inside(x, y)) {
        const t = s.board[sq(x, y)];
        if (t?.color === p.color) break;
        out.push({ from, to: sq(x, y) });
        if (t) break;
        x += df!; y += dr!;
      }
    }
  };
  if (p.kind === "knight") for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] as const) push(f + df, r + dr);
  if (p.kind === "rook" || p.kind === "queen") slide([[1, 0], [-1, 0], [0, 1], [0, -1]]);
  if (p.kind === "bishop" || p.kind === "queen") slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  if (p.kind === "king") {
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (df || dr) push(f + df, r + dr);
    const home = p.color === "white" ? 0 : 7, foe = other(p.color), rights = s.castling[p.color];
    if (r === home && f === 4 && !attacked(s.board, from, foe)) {
      const empty = (...fs: number[]) => fs.every((x) => !s.board[sq(x, home)]);
      const safe = (...fs: number[]) => fs.every((x) => !attacked(s.board, sq(x, home), foe));
      if (rights.k && s.board[sq(7, home)]?.kind === "rook" && empty(5, 6) && safe(5, 6)) out.push({ from, to: sq(6, home), castle: "k" });
      if (rights.q && s.board[sq(0, home)]?.kind === "rook" && empty(1, 2, 3) && safe(2, 3)) out.push({ from, to: sq(2, home), castle: "q" });
    }
  }
  if (p.kind === "pawn") {
    const d = p.color === "white" ? 1 : -1, start = p.color === "white" ? 1 : 6, last = p.color === "white" ? 7 : 0;
    const add = (to: Square, ep = false) => {
      if (rankOf(to) === last) for (const promotion of ["queen", "rook", "bishop", "knight"] as const) out.push({ from, to, promotion });
      else out.push({ from, to, ep });
    };
    if (inside(f, r + d) && !s.board[sq(f, r + d)]) {
      add(sq(f, r + d));
      if (r === start && !s.board[sq(f, r + 2 * d)]) out.push({ from, to: sq(f, r + 2 * d) });
    }
    for (const df of [-1, 1]) {
      if (!inside(f + df, r + d)) continue;
      const to = sq(f + df, r + d), t = s.board[to];
      if (t && t.color !== p.color) add(to);
      else if (!t && s.enPassant === to) add(to, true);
    }
  }
  return out;
}

function apply(board: Board, m: Raw): Board {
  const b: Board = { ...board };
  const p = b[m.from]!;
  delete b[m.from];
  if (m.ep) delete b[sq(fileOf(m.to), rankOf(m.from))];
  b[m.to] = m.promotion ? { color: p.color, kind: m.promotion } : p;
  if (m.castle) {
    const home = rankOf(m.from);
    const [rf, rt] = m.castle === "k" ? [7, 5] : [0, 3];
    b[sq(rt, home)] = b[sq(rf, home)]!;
    delete b[sq(rf, home)];
  }
  return b;
}

function legalRaw(s: State, from: Square): Raw[] {
  return pseudo(s, from).filter((m) => {
    const k = kingSquare(apply(s.board, m), s.turn);
    return !!k && !attacked(apply(s.board, m), k, other(s.turn));
  });
}

/** Squares the piece on `from` may move to. Empty when it is not that side's turn. */
export function legalMoves(s: State, from?: Square): { from: Square; to: Square; promotion?: Promotion }[] {
  const froms = from ? [from] : Object.keys(s.board);
  const all = froms.flatMap((f) => legalRaw(s, f)).map(({ from: a, to, promotion }) => (promotion ? { from: a, to, promotion } : { from: a, to }));
  return all.sort((x, y) => (x.from + x.to + (x.promotion ?? "")).localeCompare(y.from + y.to + (y.promotion ?? "")));
}

function hasMoves(s: State): boolean { return Object.keys(s.board).some((f) => legalRaw(s, f).length > 0); }

function insufficient(board: Board): boolean {
  const rest = Object.values(board).filter((p) => p.kind !== "king");
  if (rest.length === 0) return true;
  return rest.length === 1 && (rest[0]!.kind === "bishop" || rest[0]!.kind === "knight");
}

export function result(s: State): Result {
  const chk = inCheck(s);
  if (!hasMoves(s)) return chk ? { status: "checkmate", winner: other(s.turn) } : { status: "stalemate", reason: "no legal moves" };
  if (insufficient(s.board)) return { status: "draw", reason: "not enough pieces to mate" };
  if (s.halfmove >= 100) return { status: "draw", reason: "50 moves without a capture or pawn move" };
  if (s.positions.filter((k) => k === s.positions[s.positions.length - 1]).length >= 3) return { status: "draw", reason: "same position three times" };
  return chk ? { status: "check" } : { status: "playing" };
}

export class IllegalMove extends Error {
  constructor(readonly code: "bad_square" | "game_over" | "no_piece" | "not_your_piece" | "illegal_move" | "promotion_needed", message: string) { super(message); this.name = "IllegalMove"; }
}

/** Play a move. Throws `IllegalMove` with a typed code. Pawns reaching the last rank need `promotion`; it defaults to queen only when you pass it. */
export function move(s: State, from: string, to: string, promotion?: Promotion): State {
  if (!isSquare(from) || !isSquare(to)) throw new IllegalMove("bad_square", `Squares are a1 to h8, got "${from}" and "${to}".`);
  if (result(s).status === "checkmate" || result(s).status === "stalemate" || result(s).status === "draw") throw new IllegalMove("game_over", "The game is over.");
  const piece = s.board[from];
  if (!piece) throw new IllegalMove("no_piece", `There is no piece on ${from}.`);
  if (piece.color !== s.turn) throw new IllegalMove("not_your_piece", `It is ${s.turn}'s turn; ${from} holds a ${name(piece)}.`);
  const options = legalRaw(s, from).filter((m) => m.to === to);
  if (options.length === 0) throw new IllegalMove("illegal_move", `A ${name(piece)} cannot go from ${from} to ${to}. Call legal_moves to see what it can do.`);
  const m = options.length > 1 || options[0]!.promotion ? options.find((o) => o.promotion === promotion) : options[0];
  if (!m) throw new IllegalMove("promotion_needed", `Pass promotion: queen, rook, bishop or knight for ${from}${to}.`);
  const captured = !!s.board[to] || !!m.ep;
  const board = apply(s.board, m);
  const castling = { white: { ...s.castling.white }, black: { ...s.castling.black } };
  if (piece.kind === "king") castling[piece.color] = { k: false, q: false };
  for (const [at, c, side] of [["a1", "white", "q"], ["h1", "white", "k"], ["a8", "black", "q"], ["h8", "black", "k"]] as const) {
    if (from === at || to === at) castling[c][side] = false;
  }
  const next: State = {
    board, turn: other(s.turn), castling, halfmove: piece.kind === "pawn" || captured ? 0 : s.halfmove + 1,
    enPassant: piece.kind === "pawn" && Math.abs(rankOf(to) - rankOf(from)) === 2 ? sq(fileOf(from), (rankOf(from) + rankOf(to)) / 2) : null,
    history: [], positions: [...s.positions],
  };
  const res = result(next);
  const sym = res.status === "checkmate" ? "#" : res.status === "check" ? "+" : "";
  let san: string;
  if (m.castle) san = m.castle === "k" ? "O-O" : "O-O-O";
  else {
    const rivals = piece.kind === "pawn" ? [] : Object.keys(s.board).filter((o) => o !== from && s.board[o]!.color === piece.color && s.board[o]!.kind === piece.kind && legalRaw(s, o).some((x) => x.to === to));
    const dis = rivals.length === 0 ? "" : rivals.every((o) => o[0] !== from[0]) ? from[0]! : rivals.every((o) => o[1] !== from[1]) ? from[1]! : from;
    san = `${LETTER[piece.kind]}${piece.kind === "pawn" && captured ? from[0] : dis}${captured ? "x" : ""}${to}${m.promotion ? "=" + LETTER[m.promotion] : ""}${sym}`;
  }
  const n = Math.floor(s.history.length / 2) + 1;
  const text = `${name(piece)} ${from} to ${to}${captured ? " (capture)" : ""}${m.promotion ? ` promotes to ${m.promotion}` : ""}${m.castle ? " (castles)" : ""}`;
  next.history = [...s.history, { n, color: s.turn, from, to, san, text }];
  next.positions.push(key(next));
  return next;
}
