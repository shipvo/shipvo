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
  it("reports download_failed once with the release id", () => {
    expect(run(["download_failed:8"])).toEqual([["download_failed", 8]]);
  });
  it("keeps the two existing events and ignores unknown ones", () => {
    expect(run(["crash_loop_revert:5", "rolled_back", "applied:3", "verify_failed:x"]))
      .toEqual([["crash_loop_revert", 5], ["rolled_back", undefined], ["verify_failed", undefined]]);
  });
});
