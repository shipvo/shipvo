import { describe, expect, it } from "vitest";
import { parseTraceparent, traceFromMeta } from "../src/trace";
import { exportTest } from "../src/export";

const TP = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
describe("traceparent", () => {
  it("accepts a valid header", () => {
    expect(parseTraceparent(TP)).toEqual({ traceparent: TP, traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
    expect(traceFromMeta({ traceparent: TP, baggage: "k=v" })).toEqual({ traceparent: TP, traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
  });
  it("ignores bad values without throwing", () => {
    for (const v of ["", "nope", 5, null, {}, "00-" + "0".repeat(32) + "-00f067aa0ba902b7-01", "00-4bf92f3577b34da6a3ce929d0e0e4736-" + "0".repeat(16) + "-01", "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", TP.toUpperCase(), TP + "-x"])
      expect(parseTraceparent(v)).toBeUndefined();
    expect(traceFromMeta(undefined)).toBeUndefined();
    expect(traceFromMeta("x")).toBeUndefined();
  });
  it("adds a comment to the export only with trace ids", () => {
    expect(exportTest("shop", [], ["abc"])).toMatch(/^\/\/ trace id: abc\n/);
    expect(exportTest("shop", [])).toBe(exportTest("shop", [], []));
    expect(exportTest("shop", [])).not.toContain("trace id");
  });
});
