import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { bsdiff, bzip2 } from "../src/bsdiff.js";

const haveBzip2 = spawnSync("bzip2", ["--help"]).error === undefined;
const unbz = (b: Uint8Array) => { const r = spawnSync("bzip2", ["-dc"], { input: Buffer.from(b), maxBuffer: 1 << 28 }); expect(r.status).toBe(0); return new Uint8Array(r.stdout); };

function rnd(n: number, seed = 1) { const a = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; a[i] = x >>> 24; } return a; }

/** bspatch, reading the bzip2 blocks with the system tool. */
function bspatch(old: Uint8Array, patch: Uint8Array): Uint8Array {
  const off = (o: number) => { let y = 0; for (let i = 6; i >= 0; i--) y = y * 256 + patch[o + i]; return patch[o + 7] & 0x80 ? -y : y; };
  expect(new TextDecoder().decode(patch.subarray(0, 8))).toBe("BSDIFF40");
  const cl = off(8), dl = off(16), nl = off(24);
  const ctrl = unbz(patch.subarray(32, 32 + cl)), diff = unbz(patch.subarray(32 + cl, 32 + cl + dl)), extra = unbz(patch.subarray(32 + cl + dl));
  const out = new Uint8Array(nl); let o = 0, n = 0, d = 0, e = 0;
  const rd = (p: number) => { let y = 0; for (let i = 6; i >= 0; i--) y = y * 256 + ctrl[p + i]; return ctrl[p + 7] & 0x80 ? -y : y; };
  for (let c = 0; n < nl; c += 24) {
    const x = rd(c), y = rd(c + 8), z = rd(c + 16);
    for (let i = 0; i < x; i++) out[n + i] = (diff[d + i] + (o + i >= 0 && o + i < old.length ? old[o + i] : 0)) & 0xff;
    n += x; o += x; d += x;
    out.set(extra.subarray(e, e + y), n); n += y; e += y; o += z;
  }
  expect(n).toBe(nl);
  expect(d).toBe(diff.length);
  expect(e).toBe(extra.length);
  return out;
}

if (!haveBzip2 && process.env.CI) throw new Error("bzip2 is required to run these tests in CI");

const periodic = (n: number) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (i % 7) + 65; return a; };

describe.skipIf(!haveBzip2)("bsdiff", () => {
  it("periodic input does not overflow the stack", () => {
    const a = periodic(400_000);
    expect(Buffer.from(unbz(bzip2(a)))).toEqual(Buffer.from(a));
    const b = a.slice(1);
    expect(Buffer.from(bspatch(a, bsdiff(a, b)))).toEqual(Buffer.from(b));
  });

  it("diffs a multi-MB similar pair into a small patch", () => {
    const old = rnd(3_000_000, 11);
    const next = old.slice(); next.set(rnd(500, 3), 1_000_000); next.set(rnd(200, 6), 2_500_000);
    const patch = bsdiff(old, next);
    expect(patch.length).toBeLessThan(next.length * 0.01);
    expect(Buffer.from(bspatch(old, patch))).toEqual(Buffer.from(next));
  }, 60_000);

  it("bzip2 output decodes with the standard tool", () => {
    for (const data of [new Uint8Array(0), new Uint8Array([7]), new Uint8Array(5000).fill(9), rnd(3000), rnd(900_000, 3)]) {
      expect(Buffer.from(unbz(bzip2(data)))).toEqual(Buffer.from(data));
    }
  });

  it("a patch rebuilds the new file and is much smaller than it", () => {
    const old = rnd(200_000, 5);
    const next = old.slice(); next.set(rnd(300, 9), 50_000); next.set(rnd(40, 4), 120_000);
    const grown = new Uint8Array(next.length + 500); grown.set(next); grown.set(rnd(500, 2), next.length);
    const patch = bsdiff(old, grown);
    expect(patch.length).toBeLessThan(grown.length * 0.05);
    expect(Buffer.from(bspatch(old, patch))).toEqual(Buffer.from(grown));
  });

  it("handles an empty old file and unrelated files", () => {
    const next = rnd(2000, 8);
    expect(Buffer.from(bspatch(new Uint8Array(0), bsdiff(new Uint8Array(0), next)))).toEqual(Buffer.from(next));
    const old = rnd(2000, 3);
    expect(Buffer.from(bspatch(old, bsdiff(old, next)))).toEqual(Buffer.from(next));
  });
});
