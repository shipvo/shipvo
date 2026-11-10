import { describe, it, expect } from "vitest";
import { pickRevertTarget } from "../src/revert";
import { forwardRuntimeEvents } from "../src/runtimeEvents";

describe("pickRevertTarget", () => {
  const held = [{ release: 5, stateVersion: 2 }, { release: 6, stateVersion: 3 }, { release: 7, stateVersion: 1 }];
  it("skips a release with a lower state version and picks the newest eligible one", () => {
    expect(pickRevertTarget(held, 8, 3)).toEqual({ release: 6, stateVersion: 3 });
    expect(pickRevertTarget(held, 6, 2)).toEqual({ release: 5, stateVersion: 2 });
  });
  it("returns null (embedded bundle) when none is eligible", () => {
    expect(pickRevertTarget(held, 8, 4)).toBeNull();
    expect(pickRevertTarget([{ release: 7, stateVersion: 1 }], 8, 3)).toBeNull();
  });
  it("treats a device with no declared version as 0, so any earlier release is eligible", () => {
    expect(pickRevertTarget(held, 8, 0)).toEqual({ release: 7, stateVersion: 1 });
  });
});

describe("crash_loop_revert state versions", () => {
  it("passes state_version_from and state_version_to to the sender", () => {
    const got: unknown[] = [];
    forwardRuntimeEvents(["crash_loop_revert:9:3:2"], (e, r, x) => got.push([e, r, x]));
    expect(got).toEqual([["crash_loop_revert", undefined, { state_version_from: 3, state_version_to: 2 }]]);
  });
  it("older events without versions still work", () => {
    const got: unknown[] = [];
    forwardRuntimeEvents(["crash_loop_revert"], (...a) => got.push(a));
    expect(got).toEqual([["crash_loop_revert", undefined]]);
  });
});
