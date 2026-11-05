import { describe, expect, it } from "vitest";
import { forwardRuntimeEvents } from "../src/runtimeEvents";

const run = (events: string[]) => {
  const sent: [string, number | undefined][] = [];
  forwardRuntimeEvents(events, (e, r) => sent.push([e, r]));
  return sent;
};

describe("forwardRuntimeEvents", () => {
  it("reports verify_failed once with the release id", () => {
    expect(run(["verify_failed:7"])).toEqual([["verify_failed", 7]]);
  });
  it("reports two verify_failed strings as two sends", () => {
    expect(run(["verify_failed:7", "verify_failed:8"])).toEqual([["verify_failed", 7], ["verify_failed", 8]]);
  });
  it("falls back to the running release when the verify_failed id is missing", () => {
    expect(run(["verify_failed"])).toEqual([["verify_failed", undefined]]);
  });
  it("falls back to the running release when the verify_failed id is not numeric", () => {
    expect(run(["verify_failed:x"])).toEqual([["verify_failed", undefined]]);
  });
  it("reports download_failed once with the release id", () => {
    expect(run(["download_failed:8"])).toEqual([["download_failed", 8]]);
  });
  it("does not override the release for crash_loop_revert", () => {
    expect(run(["crash_loop_revert:5"])).toEqual([["crash_loop_revert", undefined]]);
  });
  it("does not override the release for rolled_back", () => {
    expect(run(["rolled_back:6"])).toEqual([["rolled_back", undefined]]);
  });
  it("ignores unknown events", () => {
    expect(run(["applied:3"])).toEqual([]);
  });
});
