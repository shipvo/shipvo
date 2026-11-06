import { describe, it, expect, vi } from "vitest";
import { emit, envelope } from "../src/json-out";

describe("json-out", () => {
  it("envelope sets ok from the exit code and caps next at three", () => {
    const n = [1, 2, 3, 4].map((i) => ({ command: `c${i}`, why: "w" }));
    expect(envelope("x", "s", {}, n, 0).ok).toBe(true);
    expect(envelope("x", "s", {}, n, 1).ok).toBe(false);
    expect(envelope("x", "s", {}, n, 2).next).toHaveLength(3);
  });
  it("emit prints one JSON line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    emit(envelope("ok", "fine", { a: 1 }, [], 0));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ ok: true, code: "ok", summary: "fine", data: { a: 1 }, next: [] });
    log.mockRestore();
  });
});
