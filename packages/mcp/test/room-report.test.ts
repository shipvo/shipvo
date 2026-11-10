import { describe, expect, it } from "vitest";
import { summariseRoom } from "../src/room-report.js";

const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, s)).toISOString();

describe("summariseRoom", () => {
  it("gives one summary per session, sorted by first entry", () => {
    const { sessions } = summariseRoom([
      { kind: "tool", at: at(5), session: "s2", agent: "b", tool: "tap", change: "new screen", title: "Cart" },
      { kind: "tool", at: at(0), session: "s1", agent: "a", tool: "open_app", change: "new screen", title: "Home" },
      { kind: "note", at: at(2), agent: "a", session: "s1", text: "found a bug" },
      { kind: "tool", at: at(10), session: "s1", agent: "a", tool: "tap", change: "error: no such ref" },
      { kind: "tool", at: at(8.6), session: "s2", agent: "b", tool: "tap", change: "none" },
      { kind: "note", at: at(9), session: "s2", agent: "b", text: "done" },
    ]);
    expect(sessions).toEqual([
      { session: "s1", agent: "a", steps: 2, seconds: 10, errors: 1, last_screen_title: "Home", notes: ["found a bug"] },
      { session: "s2", agent: "b", steps: 2, seconds: 4, errors: 0, last_screen_title: "Cart", notes: ["done"] },
    ]);
  });
  it("returns an empty list for no entries", () => {
    expect(summariseRoom([])).toEqual({ sessions: [] });
  });
  it("lists a note-only session", () => {
    expect(summariseRoom([{ kind: "note", at: at(1), session: "s9", agent: "c", text: "hi" }]).sessions)
      .toEqual([{ session: "s9", agent: "c", steps: 0, seconds: 0, errors: 0, last_screen_title: null, notes: ["hi"] }]);
  });
});
