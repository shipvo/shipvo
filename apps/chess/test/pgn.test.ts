import { expect, it } from "vitest";
import { formatPgn, pgnResult } from "../demo/pgn.mjs";

it("maps result text to PGN results", () => {
  expect(pgnResult("Checkmate, white wins")).toBe("1-0");
  expect(pgnResult("Time out, white wins")).toBe("1-0");
  expect(pgnResult("Checkmate, black wins")).toBe("0-1");
  expect(pgnResult("Stalemate, draw")).toBe("1/2-1/2");
  expect(pgnResult(null)).toBe("*");
});

it("writes tags and numbered moves", () => {
  const pgn = formatPgn({ san: ["f3", "e5", "g4", "Qh4#"], result: "Checkmate, black wins", white: "A", black: "B", date: new Date("2026-11-07T10:00:00Z") });
  expect(pgn).toContain('[Date "2026.11.07"]');
  expect(pgn.trim().split("\n").at(-1)).toBe("1. f3 e5 2. g4 Qh4# 0-1");
});
