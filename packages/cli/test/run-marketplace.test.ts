// The run page hands the phone frame the marketplace to install from: PN_CONTROL, or the hosted control plane.
import { describe, it, expect, afterEach } from "vitest";
import { renderFrame, statusClientScript } from "../../sim/frame.mjs";
import { runFramePage } from "../src/run";

const render = Object.assign((o: Parameters<typeof renderFrame>[0]) => renderFrame(o), { statusScript: statusClientScript });
const saved = process.env.PN_CONTROL;
afterEach(() => { if (saved === undefined) delete process.env.PN_CONTROL; else process.env.PN_CONTROL = saved; });

describe("run page marketplace", () => {
  it("uses PN_CONTROL for the Store, without a trailing slash", () => {
    process.env.PN_CONTROL = "https://control.example.test/";
    const h = runFramePage("android", "Tide", render as never);
    expect(h).toContain('mp="https://control.example.test"');
  });
  it("uses the hosted control plane by default", () => {
    delete process.env.PN_CONTROL;
    expect(runFramePage("ios", "Tide", render as never)).toContain('mp="https://api.shipvo.dev"');
  });
});
