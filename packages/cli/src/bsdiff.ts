// Binary patches in pure TypeScript, so `shipvo publish` needs no Python or native tool.
// Output is the standard BSDIFF40 format (bzip2 control, diff and extra blocks), which the Android and iOS runtimes already apply.

/** Larsson-Sadakane suffix sort, as used by bsdiff. Returns the suffix array of `s` (length n + 1, I[0] = n). */
function suffixSort(s: Uint8Array): Int32Array {
  const n = s.length;
  const I = new Int32Array(n + 1), V = new Int32Array(n + 1);
  // Iterative, with an explicit stack: periodic input would overflow the call stack if this recursed.
  // A task with mid >= 0 marks the equal group [start, mid) as sorted; it must run after the left part and before the right part.
  const split = (start0: number, len0: number, h: number): void => {
    const stack: number[] = [start0, len0, -1];
    while (stack.length) {
      const mid = stack.pop()!, len = stack.pop()!, start = stack.pop()!;
      if (mid >= 0) {
        // `start` = jj, `len` = kk
        for (let m = 0; m < len - start; m++) V[I[start + m]] = len - 1;
        if (start === len - 1) I[start] = -1;
        continue;
      }
      if (len < 16) {
        for (let k = start, j; k < start + len; k += j) {
          j = 1; let x = V[I[k] + h];
          for (let i = 1; k + i < start + len; i++) {
            const v = V[I[k + i] + h];
            if (v < x) { x = v; j = 0; }
            if (v === x) { const t = I[k + j]; I[k + j] = I[k + i]; I[k + i] = t; j++; }
          }
          for (let i = 0; i < j; i++) V[I[k + i]] = k + j - 1;
          if (j === 1) I[k] = -1;
        }
        continue;
      }
      const x = V[I[start + (len >> 1)] + h];
      let jj = 0, kk = 0;
      for (let i = start; i < start + len; i++) { const v = V[I[i] + h]; if (v < x) jj++; if (v === x) kk++; }
      jj += start; kk += jj;
      let i = start, j = 0, k = 0;
      while (i < jj) {
        const v = V[I[i] + h];
        if (v < x) i++;
        else if (v === x) { const t = I[i]; I[i] = I[jj + j]; I[jj + j] = t; j++; }
        else { const t = I[i]; I[i] = I[kk + k]; I[kk + k] = t; k++; }
      }
      while (jj + j < kk) {
        if (V[I[jj + j] + h] === x) j++;
        else { const t = I[jj + j]; I[jj + j] = I[kk + k]; I[kk + k] = t; k++; }
      }
      // Pushed in reverse: left runs first, then the middle update, then right.
      if (start + len > kk) stack.push(kk, start + len - kk, -1);
      stack.push(jj, kk, 0);
      if (jj > start) stack.push(start, jj - start, -1);
    }
  };

  const buckets = new Int32Array(256);
  for (let i = 0; i < n; i++) buckets[s[i]]++;
  for (let i = 1; i < 256; i++) buckets[i] += buckets[i - 1];
  for (let i = 255; i > 0; i--) buckets[i] = buckets[i - 1];
  buckets[0] = 0;
  for (let i = 0; i < n; i++) I[++buckets[s[i]]] = i;
  I[0] = n;
  for (let i = 0; i < n; i++) V[i] = buckets[s[i]];
  V[n] = 0;
  for (let i = 1; i < 256; i++) if (buckets[i] === buckets[i - 1] + 1) I[buckets[i]] = -1;
  I[0] = -1;
  for (let h = 1; I[0] !== -(n + 1); h += h) {
    let len = 0, i = 0;
    while (i < n + 1) {
      if (I[i] < 0) { len -= I[i]; i -= I[i]; }
      else {
        if (len) I[i - len] = -len;
        len = V[I[i]] + 1 - i;
        split(i, len, h);
        i += len; len = 0;
      }
    }
    if (len) I[i - len] = -len;
  }
  for (let i = 0; i < n + 1; i++) I[V[i]] = i;
  return I;
}

// ---- bzip2 writer (one Huffman table, blocks of up to 400 kB of input) ----

class Bits {
  out: number[] = [];
  private acc = 0; private n = 0;
  put(bits: number, value: number): void {
    while (bits > 16) { bits -= 16; this.put(16, Math.floor(value / 2 ** bits) & 0xffff); value = value % 2 ** bits; }
    this.acc = this.acc * 2 ** bits + value; this.n += bits;
    while (this.n >= 8) { this.n -= 8; this.out.push(Math.floor(this.acc / 2 ** this.n) & 0xff); this.acc = this.acc % 2 ** this.n; }
  }
  finish(): Uint8Array { if (this.n > 0) this.put(8 - this.n, 0); return Uint8Array.from(this.out); }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; t[i] = c >>> 0; }
  return t;
})();

/** Code lengths (at most `max`) for the given frequencies. */
function huffmanLengths(freq: number[], max: number): number[] {
  type Node = { w: number; sym: number; a?: Node; b?: Node };
  let f = freq.map((x) => Math.max(1, x));
  for (;;) {
    const leaves: Node[] = f.map((w, sym) => ({ w, sym })).sort((x, y) => x.w - y.w);
    const merged: Node[] = []; let i1 = 0, i2 = 0;
    const take = (): Node => (i2 >= merged.length || (i1 < leaves.length && leaves[i1].w <= merged[i2].w) ? leaves[i1++] : merged[i2++]);
    for (let left = leaves.length; left > 1; left--) { const a = take(), b = take(); merged.push({ w: a.w + b.w, sym: -1, a, b }); }
    const lens = new Array<number>(f.length).fill(0);
    const walk = (nd: Node, d: number): void => { if (nd.a && nd.b) { walk(nd.a, d + 1); walk(nd.b, d + 1); } else lens[nd.sym] = Math.max(1, d); };
    walk(merged[merged.length - 1], 0);
    if (Math.max(...lens) <= max) return lens;
    f = f.map((x) => 1 + (x >> 1));
  }
}

function bzipBlock(bits: Bits, raw: Uint8Array): number {
  // CRC of the original bytes.
  let crc = 0xffffffff;
  for (const b of raw) crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  crc = ~crc >>> 0;
  // Initial run-length step: 4 equal bytes are followed by a count of further repeats.
  const B: number[] = [];
  for (let i = 0; i < raw.length;) {
    let j = i; while (j < raw.length && raw[j] === raw[i] && j - i < 255 + 4) j++;
    const run = j - i;
    if (run >= 4) { B.push(raw[i], raw[i], raw[i], raw[i], run - 4); } else for (let k = 0; k < run; k++) B.push(raw[i]);
    i = j;
  }
  const n = B.length;
  // Burrows-Wheeler transform through the suffix array of the doubled block.
  const TT = new Uint8Array(2 * n); TT.set(B); TT.set(B, n);
  const sa = suffixSort(TT);
  const last = new Uint8Array(n); let origPtr = 0, w = 0;
  for (let k = 0; k <= 2 * n; k++) {
    const p = sa[k]; if (p >= n) continue;
    if (p === 0) origPtr = w;
    last[w++] = B[(p + n - 1) % n];
  }
  // Symbol map, move-to-front and zero-run coding.
  const used = new Array<boolean>(256).fill(false); for (const b of B) used[b] = true;
  const order: number[] = []; for (let i = 0; i < 256; i++) if (used[i]) order.push(i);
  const nIn = order.length, EOB = nIn + 1, alpha = nIn + 2;
  const mtf = order.slice(); const syms: number[] = []; let zrun = 0;
  const flush = () => { if (!zrun) return; let z = zrun - 1; for (;;) { syms.push(z & 1); if (z < 2) break; z = (z - 2) >> 1; } zrun = 0; };
  for (let i = 0; i < n; i++) {
    const b = last[i]; const j = mtf.indexOf(b);
    if (j === 0) { zrun++; continue; }
    flush(); mtf.splice(j, 1); mtf.unshift(b); syms.push(j + 1);
  }
  flush(); syms.push(EOB);
  const freq = new Array<number>(alpha).fill(0); for (const s of syms) freq[s]++;
  const lens = huffmanLengths(freq, 17);
  const codes = new Array<number>(alpha).fill(0);
  { let code = 0; for (let l = 1; l <= 17; l++) { for (let s = 0; s < alpha; s++) if (lens[s] === l) codes[s] = code++; code <<= 1; } }

  bits.put(24, 0x314159); bits.put(24, 0x265359); bits.put(32, crc);
  bits.put(1, 0); bits.put(24, origPtr);
  let top = 0; const mapBits: number[] = [];
  for (let g = 0; g < 16; g++) { let any = false, m = 0; for (let i = 0; i < 16; i++) { m = (m << 1) | (used[g * 16 + i] ? 1 : 0); any ||= used[g * 16 + i]; } if (any) top |= 1 << (15 - g); mapBits.push(any ? m : -1); }
  bits.put(16, top); for (const m of mapBits) if (m >= 0) bits.put(16, m);
  const nSel = Math.ceil(syms.length / 50);
  bits.put(3, 2); bits.put(15, nSel);
  for (let i = 0; i < nSel; i++) bits.put(1, 0); // every group of 50 symbols uses table 0
  for (let t = 0; t < 2; t++) { // the second table is the same; it is never selected
    let cur = lens[0]; bits.put(5, cur);
    for (let s = 0; s < alpha; s++) { while (cur < lens[s]) { bits.put(2, 2); cur++; } while (cur > lens[s]) { bits.put(2, 3); cur--; } bits.put(1, 0); }
  }
  for (const s of syms) bits.put(lens[s], codes[s]);
  return crc;
}

/** Compress to a standard .bz2 stream. */
export function bzip2(data: Uint8Array): Uint8Array {
  const bits = new Bits();
  bits.put(8, 0x42); bits.put(8, 0x5a); bits.put(8, 0x68); bits.put(8, 0x39);
  let combined = 0;
  for (let off = 0; off < data.length; off += 400_000) {
    const crc = bzipBlock(bits, data.subarray(off, Math.min(off + 400_000, data.length)));
    combined = ((((combined << 1) | (combined >>> 31)) ^ crc) >>> 0);
  }
  bits.put(24, 0x177245); bits.put(24, 0x385090); bits.put(32, combined);
  return bits.finish();
}

// ---- bsdiff ----

function offtout(x: number, buf: Uint8Array, o: number): void {
  let y = Math.abs(x);
  for (let i = 0; i < 8; i++) { buf[o + i] = y % 256; y = Math.floor(y / 256); }
  if (x < 0) buf[o + 7] |= 0x80;
}

/** A BSDIFF40 patch that turns `oldData` into `newData`. */
export function bsdiff(oldData: Uint8Array, newData: Uint8Array): Uint8Array<ArrayBuffer> {
  const oldSize = oldData.length, newSize = newData.length;
  const I = suffixSort(oldData);
  const matchLen = (a: number, b: number): number => { let i = 0; while (a + i < oldSize && b + i < newSize && oldData[a + i] === newData[b + i]) i++; return i; };
  let pos = 0;
  const search = (nOff: number, st: number, en: number): number => {
    while (en - st >= 2) {
      const x = st + ((en - st) >> 1);
      const a = I[x]; const lim = Math.min(oldSize - a, newSize - nOff);
      let c = 0;
      for (let i = 0; i < lim; i++) { const d = oldData[a + i] - newData[nOff + i]; if (d) { c = d; break; } }
      // Equal over the shared length: the shorter suffix sorts first, as in the suffix array (keeps long matches reachable on repetitive data).
      if (c === 0 && oldSize - a < newSize - nOff) c = -1;
      if (c < 0) st = x; else en = x;
    }
    const x = matchLen(I[st], nOff), y = matchLen(I[en], nOff);
    if (x > y) { pos = I[st]; return x; }
    pos = I[en]; return y;
  };

  const ctrl: number[] = []; const diffB: number[] = []; const extraB: number[] = [];
  let scan = 0, len = 0, lastScan = 0, lastPos = 0, lastOffset = 0;
  while (scan < newSize) {
    let oldScore = 0;
    for (let scsc = (scan += len); scan < newSize; scan++) {
      len = search(scan, 0, oldSize);
      for (; scsc < scan + len; scsc++) if (scsc + lastOffset < oldSize && oldData[scsc + lastOffset] === newData[scsc]) oldScore++;
      if ((len === oldScore && len !== 0) || len > oldScore + 8) break;
      if (scan + lastOffset < oldSize && oldData[scan + lastOffset] === newData[scan]) oldScore--;
    }
    if (len !== oldScore || scan === newSize) {
      let s = 0, sf = 0, lenF = 0;
      for (let i = 0; lastScan + i < scan && lastPos + i < oldSize;) {
        if (oldData[lastPos + i] === newData[lastScan + i]) s++;
        i++;
        if (s * 2 - i > sf * 2 - lenF) { sf = s; lenF = i; }
      }
      let lenB = 0;
      if (scan < newSize) {
        s = 0; let sb = 0;
        for (let i = 1; scan >= lastScan + i && pos >= i; i++) {
          if (oldData[pos - i] === newData[scan - i]) s++;
          if (s * 2 - i > sb * 2 - lenB) { sb = s; lenB = i; }
        }
      }
      if (lastScan + lenF > scan - lenB) {
        const overlap = lastScan + lenF - (scan - lenB);
        s = 0; let ss = 0, lenS = 0;
        for (let i = 0; i < overlap; i++) {
          if (newData[lastScan + lenF - overlap + i] === oldData[lastPos + lenF - overlap + i]) s++;
          if (newData[scan - lenB + i] === oldData[pos - lenB + i]) s--;
          if (s > ss) { ss = s; lenS = i + 1; }
        }
        lenF += lenS - overlap; lenB -= lenS;
      }
      for (let i = 0; i < lenF; i++) diffB.push((newData[lastScan + i] - oldData[lastPos + i]) & 0xff);
      const extraLen = scan - lenB - (lastScan + lenF);
      for (let i = 0; i < extraLen; i++) extraB.push(newData[lastScan + lenF + i]);
      const c = new Uint8Array(24);
      offtout(lenF, c, 0); offtout(extraLen, c, 8); offtout(pos - lenB - (lastPos + lenF), c, 16);
      for (const b of c) ctrl.push(b);
      lastScan = scan - lenB; lastPos = pos - lenB; lastOffset = pos - scan;
    }
  }
  const cz = bzip2(Uint8Array.from(ctrl)), dz = bzip2(Uint8Array.from(diffB)), ez = bzip2(Uint8Array.from(extraB));
  const out = new Uint8Array(new ArrayBuffer(32 + cz.length + dz.length + ez.length));
  out.set([0x42, 0x53, 0x44, 0x49, 0x46, 0x46, 0x34, 0x30]); // "BSDIFF40"
  offtout(cz.length, out, 8); offtout(dz.length, out, 16); offtout(newSize, out, 24);
  out.set(cz, 32); out.set(dz, 32 + cz.length); out.set(ez, 32 + cz.length + dz.length);
  return out;
}
