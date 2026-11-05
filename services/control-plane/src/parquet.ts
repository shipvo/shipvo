import { TELEMETRY_EXPORT_COLUMNS, TELEMETRY_EXPORT_VERSION } from "@shipvo/schema";

/** A small Parquet writer: one row group, PLAIN encoding, no compression, flat schema. Enough for the telemetry export and readable by DuckDB, Spark and pyarrow. */
type Col = { name: string; type: "int64" | "double" | "string"; nullable: boolean };

// Thrift compact protocol, only the parts Parquet metadata needs.
const T = { I32: 5, I64: 6, BIN: 8, LIST: 9, STRUCT: 12 };
class Thrift {
  out: number[] = []; private last: number[] = [0];
  private varint(n: bigint) { while (n >= 0x80n) { this.out.push(Number(n & 0x7fn) | 0x80); n >>= 7n; } this.out.push(Number(n)); }
  private zz(n: number | bigint) { const b = BigInt(n); this.varint(b >= 0n ? b << 1n : ((-b) << 1n) - 1n); }
  private head(id: number, type: number) {
    const d = id - this.last[this.last.length - 1];
    if (d > 0 && d <= 15) this.out.push((d << 4) | type); else { this.out.push(type); this.zz(id); }
    this.last[this.last.length - 1] = id;
  }
  i32(id: number, v: number) { this.head(id, T.I32); this.zz(v); }
  i64(id: number, v: number) { this.head(id, T.I64); this.zz(v); }
  bin(id: number, s: string) { this.head(id, T.BIN); this.str(s); }
  private str(s: string) { const b = new TextEncoder().encode(s); this.varint(BigInt(b.length)); this.out.push(...b); }
  list(id: number, type: number, n: number) { this.head(id, T.LIST); if (n < 15) this.out.push((n << 4) | type); else { this.out.push(0xf0 | type); this.varint(BigInt(n)); } }
  listI32(v: number) { this.zz(v); }
  listStr(s: string) { this.str(s); }
  begin(id?: number) { if (id !== undefined) this.head(id, T.STRUCT); this.last.push(0); }
  end() { this.out.push(0); this.last.pop(); }
}

const TYPE = { int64: 2, double: 5, string: 6 } as const;
const le = (n: number, bytes: number) => { const b = new Uint8Array(bytes); new DataView(b.buffer).setUint32(0, n, true); return b; };

function encodeColumn(col: Col, values: unknown[]): Uint8Array {
  const parts: Uint8Array[] = [];
  if (col.nullable) {
    // Definition levels, RLE/bit-packed hybrid with bit width 1, behind a 4-byte length.
    const groups = Math.ceil(values.length / 8); const bits = new Uint8Array(groups);
    values.forEach((v, i) => { if (v !== null && v !== undefined) bits[i >> 3] |= 1 << (i & 7); });
    const hdr: number[] = []; let h = (groups << 1) | 1; while (h >= 0x80) { hdr.push((h & 0x7f) | 0x80); h >>>= 7; } hdr.push(h);
    parts.push(le(hdr.length + bits.length, 4), Uint8Array.from(hdr), bits);
  }
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (col.type === "int64") { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(v as number), true); parts.push(b); }
    else if (col.type === "double") { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v as number, true); parts.push(b); }
    else { const s = new TextEncoder().encode(String(v)); parts.push(le(s.length, 4), s); }
  }
  const len = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function writeParquet(rows: Record<string, unknown>[], columns: ReadonlyArray<Col> = TELEMETRY_EXPORT_COLUMNS, meta: Record<string, string> = { "shipvo.telemetry_export_version": TELEMETRY_EXPORT_VERSION }): Uint8Array {
  const chunks: Uint8Array[] = [new TextEncoder().encode("PAR1")]; let pos = 4;
  const info: { col: Col; offset: number; size: number }[] = [];
  for (const col of columns) {
    const data = encodeColumn(col, rows.map((r) => r[col.name]));
    const t = new Thrift(); t.begin();
    t.i32(1, 0); t.i32(2, data.length); t.i32(3, data.length);
    t.begin(5); t.i32(1, rows.length); t.i32(2, 0); t.i32(3, 3); t.i32(4, 3); t.end();
    t.end();
    const page = Uint8Array.from(t.out);
    info.push({ col, offset: pos, size: page.length + data.length });
    chunks.push(page, data); pos += page.length + data.length;
  }
  const f = new Thrift(); f.begin();
  f.i32(1, 1);
  f.list(2, T.STRUCT, columns.length + 1);
  f.begin(); f.bin(4, "schema"); f.i32(5, columns.length); f.end();
  for (const c of columns) { f.begin(); f.i32(1, TYPE[c.type]); f.i32(3, c.nullable ? 1 : 0); f.bin(4, c.name); if (c.type === "string") f.i32(6, 0); f.end(); }
  f.i64(3, rows.length);
  f.list(4, T.STRUCT, 1);
  f.begin();
  f.list(1, T.STRUCT, info.length);
  for (const i of info) {
    f.begin(); f.i64(2, i.offset);
    f.begin(3); f.i32(1, TYPE[i.col.type]); f.list(2, T.I32, 1); f.listI32(0); f.list(3, T.BIN, 1); f.listStr(i.col.name);
    f.i32(4, 0); f.i64(5, rows.length); f.i64(6, i.size); f.i64(7, i.size); f.i64(9, i.offset); f.end();
    f.end();
  }
  f.i64(2, pos - 4); f.i64(3, rows.length);
  f.end();
  const kv = Object.entries(meta);
  f.list(5, T.STRUCT, kv.length);
  for (const [k, v] of kv) { f.begin(); f.bin(1, k); f.bin(2, v); f.end(); }
  f.bin(6, "shipvo control-plane");
  f.end();
  const footer = Uint8Array.from(f.out);
  chunks.push(footer, le(footer.length, 4), new TextEncoder().encode("PAR1"));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
