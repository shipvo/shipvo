import { describe, expect, it } from "vitest";
import {
  Game, applyMove, describeMove, describePieceAt, findLegalMove, isInCheck, legalMoves, moveToUci,
  parseFen, parseSquare, perft, repetitionKey, squareName, startPosition, toFen,
} from "../src/index.js";

const uci = (fen: string) => legalMoves(parseFen(fen)).map(moveToUci);

describe("perft", () => {
  it("start position depth 1-3", () => {
    const p = startPosition();
    expect(perft(p, 1)).toBe(20);
    expect(perft(p, 2)).toBe(400);
    expect(perft(p, 3)).toBe(8902);
  });
  it("kiwipete depth 1-2", () => {
    const p = parseFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    expect(perft(p, 1)).toBe(48);
    expect(perft(p, 2)).toBe(2039);
  });
  it("position 3 depth 3 (en passant and pins)", () => {
    expect(perft(parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 3)).toBe(2812);
  });
});

describe("naming", () => {
  it("names squares and pieces", () => {
    expect(squareName(parseSquare("e4"))).toBe("e4");
    expect(parseSquare("a1")).toBe(0);
    expect(describePieceAt(startPosition(), parseSquare("g1"))).toBe("white knight on g1");
    expect(describeMove(startPosition(), { from: parseSquare("g1"), to: parseSquare("f3") })).toBe("white knight from g1 to f3");
  });
});

describe("special moves", () => {
  it("castles both sides", () => {
    const m = uci("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(m).toContain("e1g1");
    expect(m).toContain("e1c1");
    const p = applyMove(parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), { from: 4, to: 6 });
    expect(toFen(p).split(" ")[0]).toBe("r3k2r/8/8/8/8/8/8/R4RK1");
    expect(p.castling.wK).toBe(false);
  });
  it("cannot castle through check, out of check, or without rights", () => {
    expect(uci("4kr2/8/8/8/8/8/8/4K2R w K - 0 1")).not.toContain("e1g1"); // f1 attacked
    expect(uci("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1")).toContain("e1g1");
    expect(uci("3rk3/8/8/8/8/8/8/R3K2R w KQ - 0 1")).not.toContain("e1c1"); // d1 attacked
    expect(uci("4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1")).not.toContain("e1g1"); // in check
    expect(uci("6k1/8/8/8/8/8/8/R3K2R w - - 0 1")).not.toContain("e1g1");
  });
  it("queen side castling allows an attacked b-file square", () => {
    expect(uci("1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1")).toContain("e1c1");
  });
  it("loses rights when a rook is captured", () => {
    const p = applyMove(parseFen("r3k2r/8/8/8/8/8/6B1/R3K2R w KQkq - 0 1"), { from: parseSquare("g2"), to: parseSquare("a8") });
    expect(p.castling.bQ).toBe(false);
    expect(p.castling.bK).toBe(true);
  });
  it("en passant captures and removes the pawn", () => {
    const g = new Game(parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"));
    g.play("e5d6");
    expect(toFen(g.position).split(" ")[0]).toBe("4k3/8/3P4/8/8/8/8/4K3");
  });
  it("en passant is set after a double push and expires", () => {
    let p = parseFen("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1");
    p = applyMove(p, { from: parseSquare("d7"), to: parseSquare("d5") });
    expect(p.ep).toBe(parseSquare("d6"));
    expect(uci(toFen(p))).toContain("e5d6");
    p = applyMove(p, { from: parseSquare("e1"), to: parseSquare("e2") });
    expect(p.ep).toBeNull();
  });
  it("en passant that exposes the king is illegal", () => {
    expect(uci("8/8/8/KPp4r/8/8/8/4k3 w - c6 0 1")).not.toContain("b5c6");
  });
  it("promotes to all four pieces, defaults to queen", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(uci(fen).filter((m) => m.startsWith("a7a8")).sort()).toEqual(["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);
    const p = parseFen(fen);
    const m = findLegalMove(p, { from: parseSquare("a7"), to: parseSquare("a8") })!;
    expect(applyMove(p, m).board[parseSquare("a8")]).toEqual({ color: "w", type: "q" });
    const n = applyMove(p, { from: parseSquare("a7"), to: parseSquare("a8"), promotion: "n" });
    expect(n.board[parseSquare("a8")]).toEqual({ color: "w", type: "n" });
  });
});

describe("game end", () => {
  it("detects stalemate", () => {
    const g = new Game(parseFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"));
    expect(isInCheck(g.position)).toBe(false);
    expect(g.status()).toEqual({ state: "draw", reason: "stalemate" });
  });
  it("detects fool's mate", () => {
    const g = new Game();
    for (const m of ["f2f3", "e7e5", "g2g4", "d8h4"]) g.play(m);
    expect(g.status()).toEqual({ state: "checkmate", winner: "b" });
    expect(() => g.play("a2a3")).toThrow();
  });
  it("rejects illegal moves", () => {
    expect(() => new Game().play("e2e5")).toThrow(/Illegal/);
  });
  it("threefold repetition is claimable, not automatic", () => {
    const g = new Game();
    const cycle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    for (const m of cycle) g.play(m);
    expect(g.repetitions()).toBe(2);
    expect(g.claims().threefold).toBe(false);
    expect(g.claimDraw()).toBe(false);
    for (const m of cycle) g.play(m);
    expect(g.repetitions()).toBe(3);
    expect(g.claims().threefold).toBe(true);
    expect(g.status().state).toBe("playing");
    expect(g.claimDraw()).toBe(true);
    expect(() => g.play("e2e4")).toThrow();
  });
  it("fivefold repetition is automatic", () => {
    const g = new Game();
    for (let i = 0; i < 4; i++) for (const m of ["g1f3", "g8f6", "f3g1", "f6g8"]) g.play(m);
    expect(g.status()).toEqual({ state: "draw", reason: "fivefold-repetition" });
  });
  it("repetition key includes castling rights", () => {
    const a = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const b = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
    expect(repetitionKey(a)).not.toBe(repetitionKey(b));
  });
  it("repetition key includes en passant only when capture is possible", () => {
    const withCapture = parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    const withCaptureNoEp = parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
    expect(repetitionKey(withCapture)).not.toBe(repetitionKey(withCaptureNoEp));
    const noCapturer = parseFen("4k3/8/8/3p4/8/8/8/4K3 w - d6 0 1");
    const noCapturerNoEp = parseFen("4k3/8/8/3p4/8/8/8/4K3 w - - 0 1");
    expect(repetitionKey(noCapturer)).toBe(repetitionKey(noCapturerNoEp));
  });
  it("50-move rule is claimable; 75-move rule is automatic", () => {
    const g100 = new Game(parseFen("4k3/8/8/8/8/8/R7/4K3 w - - 100 80"));
    expect(g100.status().state).toBe("playing");
    expect(g100.claims().fiftyMove).toBe(true);
    expect(g100.claimDraw()).toBe(true);
    const g99 = new Game(parseFen("4k3/8/8/8/8/8/R7/4K3 w - - 99 80"));
    expect(g99.claims().fiftyMove).toBe(false);
    const g150 = new Game(parseFen("4k3/8/8/8/8/8/R7/4K3 w - - 150 100"));
    expect(g150.status()).toEqual({ state: "draw", reason: "seventy-five-move" });
  });
  it("75-move rule yields to checkmate on the last move", () => {
    const g = new Game(parseFen("7k/8/6K1/8/8/8/8/R7 w - - 149 100"));
    g.play("a1a8");
    expect(g.status().state).toBe("checkmate");
  });
  it("insufficient material", () => {
    expect(new Game(parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).status()).toEqual({ state: "draw", reason: "insufficient-material" });
    expect(new Game(parseFen("4k3/8/8/8/8/8/8/3NK3 w - - 0 1")).status().state).toBe("draw");
    expect(new Game(parseFen("4k3/8/8/8/8/8/P7/4K3 w - - 0 1")).status().state).toBe("playing");
  });
  it("round-trips FEN", () => {
    const f = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    expect(toFen(parseFen(f))).toBe(f);
  });
});
