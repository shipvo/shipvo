import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** The two cohort cut-offs from `c < A ... c < B` in a native Store. */
function thresholds(src: string): number[] {
  const line = src.split("\n").find((l) => /\b(band|cohort)\b.*<\s*\d+.*<\s*\d+/.test(l) && l.includes("b0"));
  if (!line) throw new Error("band line not found");
  return [...line.matchAll(/<\s*(\d+)/g)].map((m) => Number(m[1]));
}

describe("band thresholds", () => {
  const schema = read("../../schema/src/index.ts");
  const m = schema.match(/b0:\s*\[0,\s*(\d+)\],\s*b1:\s*\[\1,\s*(\d+)\],\s*b2:\s*\[\2,/);
  if (!m) throw new Error("BAND_RANGES not found in schema");
  const fromSchema = [Number(m[1]), Number(m[2])];
  it("reads the schema values", () => expect(fromSchema).toEqual([10, 100]));
  it("Kotlin Store matches the schema", () =>
    expect(thresholds(read("../android/src/main/java/dev/shipvo/runtime/Store.kt"))).toEqual(fromSchema));
  it("Swift Store matches the schema", () =>
    expect(thresholds(read("../ios/Store.swift"))).toEqual(fromSchema));
  it("the reader sees a changed value", () =>
    expect(thresholds('val band = if (it < 10) "b0" else if (it < 50) "b1" else "b2"')).not.toEqual(fromSchema));
});
