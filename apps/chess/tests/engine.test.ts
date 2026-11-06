import { describe, expect, test } from "vitest";
import { ChessGame } from "../src/actions";
import { fromPieces, inCheck, legalMoves, move, newGame, result } from "../src/engine";

const play = (g: ChessGame, ...mv: string[]) => mv.forEach((m) => { const r = g.move(m.slice(0, 2), m.slice(2, 4)); expect(r.ok, m).toBe(true); });

describe("rules", () => {
  test("20 legal moves at the start", () => expect(legalMoves(newGame())).toHaveLength(20));
  test("perft depth 2 and 3 match the known counts", () => {
    const count = (s: ReturnType<typeof newGame>, d: number): number =>
      d === 0 ? 1 : legalMoves(s).reduce((n, m) => n + count(move(s, m.from, m.to, m.promotion), d - 1), 0);
    expect(count(newGame(), 2)).toBe(400);
    expect(count(newGame(), 3)).toBe(8902);
  });
  test("fool's mate is checkmate for black", () => {
    const g = new ChessGame();
    play(g, "f2f3", "e7e5", "g2g4", "d8h4");
    expect(g.get_board().status).toEqual({ status: "checkmate", winner: "black" });
    expect(g.move("a2", "a3")).toMatchObject({ ok: false, code: "game_over" });
  });
  test("castling kingside and not through check", () => {
    const g = new ChessGame();
    play(g, "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6");
    const r = g.move("e1", "g1");
    expect(r).toMatchObject({ ok: true, move: { san: "O-O" } });
    const s = fromPieces({ e1: "K", h1: "R", f8: "r", e8: "k" });
    s.castling.white.k = true;
    expect(legalMoves(s, "e1").some((m) => m.to === "g1")).toBe(false);
  });
  test("en passant", () => {
    const g = new ChessGame();
    play(g, "e2e4", "a7a6", "e4e5", "d7d5");
    expect(g.move("e5", "d6")).toMatchObject({ ok: true, move: { san: "exd6" } });
    expect(g.get_board().pieces.d5).toBeUndefined();
  });
  test("promotion needs a choice", () => {
    const s = fromPieces({ a7: "P", h1: "K", h8: "k" });
    expect(() => move(s, "a7", "a8")).toThrow(/promotion/);
    const n = move(s, "a7", "a8", "knight");
    expect(n.board.a8).toEqual({ color: "white", kind: "knight" });
  });
  test("a pinned piece cannot move; check must be answered", () => {
    const s = fromPieces({ e1: "K", e2: "R", e8: "r", a8: "k" });
    expect(legalMoves(s, "e2").every((m) => m.to[0] === "e")).toBe(true);
    const c = fromPieces({ e1: "K", e8: "r", a8: "k", a2: "P" });
    expect(inCheck(c)).toBe(true);
    expect(legalMoves(c, "a2")).toHaveLength(0);
  });
  test("stalemate and bare kings are draws", () => {
    expect(result(fromPieces({ a8: "k", c7: "Q", c6: "K" }, "black")).status).toBe("stalemate");
    expect(result(fromPieces({ a8: "k", c6: "K" })).status).toBe("draw");
  });
  test("threefold repetition is a draw", () => {
    const g = new ChessGame();
    play(g, "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8");
    expect(g.get_board().status.status).toBe("draw");
  });
});

describe("typed actions", () => {
  test("get_board labels every square and piece", () => {
    const b = new ChessGame().get_board();
    expect(b.rows).toHaveLength(8);
    expect(b.rows[7]![0]).toBe("a1: white rook");
    expect(b.rows[0]![4]).toBe("e8: black king");
    expect(b.rows[4]![4]).toBe("e4: empty");
    expect(b.pieces.g1).toBe("white knight");
  });
  test("legal_moves lists a knight's moves", () => {
    expect(new ChessGame().legal_moves("g1")).toEqual([{ from: "g1", to: "f3" }, { from: "g1", to: "h3" }]);
  });
  test("move returns typed errors and keeps the board", () => {
    const g = new ChessGame();
    expect(g.move("e2", "e5")).toMatchObject({ ok: false, code: "illegal_move" });
    expect(g.move("e7", "e5")).toMatchObject({ ok: false, code: "not_your_piece" });
    expect(g.move("e4", "e5")).toMatchObject({ ok: false, code: "no_piece" });
    expect(g.move("z9", "e5")).toMatchObject({ ok: false, code: "bad_square" });
    expect(g.get_board().turn).toBe("white");
  });
  test("move records text and notation", () => {
    const g = new ChessGame();
    const r = g.move("g1", "f3");
    expect(r).toMatchObject({ ok: true, move: { san: "Nf3", text: "white knight g1 to f3" } });
    expect(g.get_board().moves).toHaveLength(1);
  });
});
