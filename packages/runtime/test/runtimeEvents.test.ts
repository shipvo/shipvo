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
  it("reports hermes_bytecode_mismatch under its release id", () => {
    expect(run(["hermes_bytecode_mismatch:12:release=96:shell=98"])).toEqual([["hermes_bytecode_mismatch", 12]]);
  });
  it("falls back to the running release when the mismatch id is malformed", () => {
    expect(run(["hermes_bytecode_mismatch:x:release=1:shell=2", "hermes_bytecode_mismatch"])).toEqual([
      ["hermes_bytecode_mismatch", undefined], ["hermes_bytecode_mismatch", undefined]]);
  });
  it("reports native-module pointer rejections once each", () => {
    expect(run(["pointer_rejected:native_module_missing", "pointer_rejected:native_module_version"])).toEqual([
      ["native_module_missing", undefined], ["native_module_version", undefined]]);
  });
  it("ignores other pointer_rejected reasons", () => {
    expect(run(["pointer_rejected:hermes_bytecode_mismatch", "pointer_rejected:x", "pointer_rejected"])).toEqual([]);
  });
  it("passes the load kind of a crash_loop_revert", () => {
    const sent: unknown[][] = [];
    forwardRuntimeEvents(["crash_loop_revert:5:reload", "crash_loop_revert:5:cold", "crash_loop_revert:5:bogus"], (...a) => sent.push(a));
    expect(sent).toEqual([["crash_loop_revert", undefined, "reload"], ["crash_loop_revert", undefined, "cold"], ["crash_loop_revert", undefined, undefined]]);
  });
});
