// A small QR code encoder: byte mode, error correction level L, versions 1 to 6 (up to 134 bytes). No dependencies.
// Enough for a LAN URL. `qrMatrix` returns the modules; `qrToTerminal` draws them with half-block characters.

const SIZES = [ // [data codewords, error codewords per block, blocks] for versions 1..6 at level L
  [19, 7, 1], [34, 10, 1], [55, 15, 1], [80, 20, 1], [108, 26, 1], [136, 18, 2],
] as const;
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];
export const QR_MAX_BYTES = 134;

const EXP = new Uint8Array(512); const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Reed-Solomon error codewords for `data`. */
export function rsRemainder(data: number[], degree: number): number[] {
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    gen = next;
  }
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift()!; rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], f);
  }
  return rem;
}

function codewordsFor(bytes: Uint8Array, version: number): number[] {
  const [total, ecc, blocks] = SIZES[version - 1];
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad);
  const per = total / blocks;
  const dataBlocks = Array.from({ length: blocks }, (_, i) => data.slice(i * per, (i + 1) * per));
  const eccBlocks = dataBlocks.map((b) => rsRemainder(b, ecc));
  const out: number[] = [];
  for (let i = 0; i < per; i++) for (const b of dataBlocks) out.push(b[i]);
  for (let i = 0; i < ecc; i++) for (const b of eccBlocks) out.push(b[i]);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

/** The 15 format bits for level L and a mask number. */
export function formatBits(mask: number): number {
  const data = (1 << 3) | mask; // level L is 01
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function penalty(m: boolean[][]): number {
  const n = m.length; let score = 0; let dark = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    const s = Array.from({ length: n }, (_, i) => (get(i) ? 1 : 0)).join("");
    for (const p of ["10111010000", "00001011101"]) for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) score += 40;
  };
  for (let a = 0; a < n; a++) { line((i) => m[a][i]); line((i) => m[i][a]); }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  return score + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
}

/** Encodes text as a QR code. Returns rows of modules, true for dark. Throws when the text is over 134 bytes. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = SIZES.findIndex(([total]) => bytes.length <= total - 2) + 1;
  if (!version) throw new Error(`QR code input is ${bytes.length} bytes; the limit is ${QR_MAX_BYTES}.`);
  const size = 17 + 4 * version;
  const codewords = codewordsFor(bytes, version);
  const base: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { if (x >= 0 && y >= 0 && x < size && y < size) { base[y][x] = dark; fn[y][x] = true; } };
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d !== 4 && d !== 2);
    }
  }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const pos = ALIGN[version - 1];
  for (const cy of pos) for (const cx of pos) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask: number) => {
    const f = formatBits(mask); const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0); // reserves the areas; redone below with the chosen mask
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j; const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y][x] && k < codewords.length * 8) { base[y][x] = ((codewords[k >> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
    }
  }
  let best: boolean[][] | undefined; let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = base.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    const saveBase = base.map((r) => r.slice());
    for (let y = 0; y < size; y++) base[y] = m[y];
    format(mask);
    const s = penalty(base);
    if (s < bestScore) { bestScore = s; best = base.map((r) => r.slice()); }
    for (let y = 0; y < size; y++) base[y] = saveBase[y];
  }
  return best!;
}

/** Draws the matrix for a terminal: black on white with ANSI colours, two rows per line, a 2 module quiet zone. */
export function qrToTerminal(matrix: boolean[][], quiet = 2): string {
  const n = matrix.length + quiet * 2;
  const at = (x: number, y: number) => matrix[y - quiet]?.[x - quiet] === true;
  const lines: string[] = [];
  for (let y = 0; y < n; y += 2) {
    let s = "\x1b[30;47m";
    for (let x = 0; x < n; x++) {
      const t = at(x, y), b = y + 1 < n && at(x, y + 1);
      s += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    }
    lines.push(s + "\x1b[0m");
  }
  return lines.join("\n");
}
