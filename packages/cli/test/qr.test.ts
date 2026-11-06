import { describe, expect, it } from "vitest";
import { formatBits, qrMatrix, qrToTerminal, rsRemainder } from "../src/qr";

const SIZES = [[19, 7, 1], [34, 10, 1], [55, 15, 1], [80, 20, 1], [108, 26, 1], [136, 18, 2]];
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

/** A reader written for the test: reads the format bits, unmasks, walks the zigzag, checks error correction, returns the text. */
function decode(m: boolean[][]): string {
  const size = m.length, version = (size - 17) / 4;
  let f = 0;
  for (let i = 0; i <= 5; i++) f |= +m[i][8] << i;
  f |= +m[7][8] << 6; f |= +m[8][8] << 7; f |= +m[8][7] << 8;
  for (let i = 9; i < 15; i++) f |= +m[8][14 - i] << i;
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => formatBits(k) === f);
  expect(mask).toBeDefined();
  // function module map by re-encoding is circular, so mark them by geometry
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8); mark(6, 0, 1, size); mark(0, 6, size, 1);
  const pos = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]][version - 1];
  for (const cy of pos) for (const cx of pos) if (!((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6))) mark(cx - 2, cy - 2, 5, 5);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y][x]) bits.push(+(m[y][x] !== MASKS[mask!](x, y)));
    }
  }
  const [total, ecc, blocks] = SIZES[version - 1];
  const words = Array.from({ length: total + ecc * blocks }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).join(""), 2));
  const per = total / blocks;
  const data: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const block = Array.from({ length: per }, (_, i) => words[i * blocks + b]);
    const check = Array.from({ length: ecc }, (_, i) => words[total + i * blocks + b]);
    expect(rsRemainder(block, ecc)).toEqual(check);
    data.push(...block);
  }
  const s = data.map((b) => b.toString(2).padStart(8, "0")).join("");
  expect(s.slice(0, 4)).toBe("0100");
  const n = parseInt(s.slice(4, 12), 2);
  return new TextDecoder().decode(Uint8Array.from({ length: n }, (_, i) => parseInt(s.slice(12 + i * 8, 20 + i * 8), 2)));
}

describe("qr", () => {
  it("matches the known format bits and error codewords", () => {
    expect(formatBits(0)).toBe(0b111011111000100); // level L, mask 0 (ISO 18004 table)
    // The data codewords and 7 error codewords of "01234567" version 1-M are not level L; use the classic RS vector for 16 data words, 10 ecc.
    expect(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it("encodes and decodes URLs across versions", () => {
    for (const text of ["hi", "http://192.168.1.20:4545/?t=" + "a1".repeat(16), "x".repeat(17), "x".repeat(18), "é".repeat(60), "y".repeat(134)]) {
      const m = qrMatrix(text);
      expect(m.length).toBe(m[0].length);
      expect(decode(m)).toBe(text);
    }
  });
  it("has the expected size and finder patterns", () => {
    const m = qrMatrix("hello");
    expect(m.length).toBe(21);
    for (const [x, y] of [[0, 0], [14, 0], [0, 14]]) { expect(m[y][x]).toBe(true); expect(m[y + 3][x + 3]).toBe(true); expect(m[y + 1][x + 1]).toBe(false); }
    expect(m[13][8]).toBe(true); // dark module
  });
  it("refuses input over the limit", () => { expect(() => qrMatrix("x".repeat(135))).toThrow(/limit/); });
  it("draws two rows per terminal line", () => {
    const out = qrToTerminal(qrMatrix("hello"));
    expect(out.split("\n").length).toBe(13); // (21 + 4) / 2 rounded up
  });
});
