import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentDeviceDriver, openApp, parseSnapshot, toScreen, sizesOf, NOT_INSTALLED } from "../src/index.js";

// A fake `agent-device` that logs its arguments and answers `snapshot --json` with recorded output.
const SNAPSHOT = JSON.stringify({ nodes: [
  { ref: "e1", kind: "application", label: "Tide" },
  { ref: "e2", kind: "text", label: "Welcome back", rect: { x: 0, y: 40, width: 200, height: 20 } },
  { ref: "e3", kind: "button", label: "Sign in", rect: { x: 10, y: 100, width: 120, height: 52 } },
  { ref: "e4", kind: "text-field", label: "Email", rect: { x: 10, y: 160, width: 300, height: 52 } },
  { ref: "e5", kind: "button", label: "Close", rect: { x: 340, y: 20, width: 24, height: 24 } },
] });
let dir: string, log: string;
const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fake-ad-"));
  log = join(dir, "calls.log");
  const bin = join(dir, "agent-device");
  writeFileSync(log, "");
  writeFileSync(bin, `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
if (a[0] === "snapshot") process.stdout.write(${JSON.stringify(SNAPSHOT)});
else if (a[0] === "screenshot") fs.writeFileSync(a[1], Buffer.from([137, 80, 78, 71]));
else if (a[0] === "click" && a[1] === "@e99") { process.stderr.write("no such ref"); process.exit(1); }
else process.stdout.write("ok");
`);
  chmodSync(bin, 0o755);
  process.env.SHIPVO_AGENT_DEVICE_BIN = bin;
});
afterEach(() => { delete process.env.SHIPVO_AGENT_DEVICE_BIN; delete process.env.SHIPVO_DEVICE_DRIVER; });

describe("agent-device driver", () => {
  it("maps the snapshot to the screen tree with roles, names and bounds", () => {
    const screen = toScreen(parseSnapshot(SNAPSHOT));
    expect(screen).toContain('- button "Sign in" [ref=e3] [bounds=10,100,120,52]');
    expect(screen).toContain('- textbox "Email" [ref=e4]');
    expect(screen).toContain("- text [ref=e2] [bounds=0,40,200,20]: Welcome back");
  });
  it("reads the text snapshot form too", () => {
    const nodes = parseSnapshot('Snapshot: 2 nodes\n@e1 [application] "Contacts"\n  @e6 [button] "New \\"List\\""\n');
    expect(nodes.map((n) => [n.ref, n.kind, n.label])).toEqual([["e1", "application", "Contacts"], ["e6", "button", 'New "List"']]);
  });
  it("reports sizes so small targets can be found", () => {
    const sizes = sizesOf(parseSnapshot(SNAPSHOT));
    expect(sizes.e5).toEqual([24, 24]);
    expect(sizes.e3).toEqual([120, 52]);
  });
  it("taps by name", async () => {
    const phone = await openApp({ app: "dev.tide", driver: "agent-device", platform: "ios" });
    expect(calls()[0]).toEqual(["open", "dev.tide", "--platform", "ios"]);
    await phone.tap("Sign in");
    expect(calls().some((c) => c[0] === "click" && c[1] === "@e3")).toBe(true);
    expect(phone.sees("Welcome back")).toBe(true);
  });
  it("types into a field, scrolls, goes back and takes a screenshot", async () => {
    process.env.SHIPVO_DEVICE_DRIVER = "agent-device";
    const phone = await openApp({ app: "dev.tide" });
    await phone.type("Email", "a@b.co");
    await phone.scroll("down");
    await phone.back();
    expect(calls()).toEqual(expect.arrayContaining([["fill", "@e4", "a@b.co", "--platform", "android"], ["scroll", "down", "--platform", "android"], ["back", "--platform", "android"]]));
    expect(Array.from(await phone.screenshot())).toEqual([137, 80, 78, 71]);
  });
  it("says what failed when the CLI fails", async () => {
    const phone = await openApp({ app: "dev.tide", driver: "agent-device" });
    await expect((phone as unknown as { ad: { tap(r: string): Promise<void> } }).ad.tap("e99")).rejects.toThrow(/no such ref/);
  });
  it("gives the explorer driver the same screen and sizes", async () => {
    const d = agentDeviceDriver("dev.tide");
    expect((await d.open()).screen).toContain('button "Sign in"');
    expect((await d.tap("e3")).ok).toBe(true);
    expect((await d.sizes())["e5"]).toEqual([24, 24]);
  });
  it("gives a clear error when agent-device is missing", async () => {
    process.env.SHIPVO_AGENT_DEVICE_BIN = join(dir, "nope");
    await expect(openApp({ app: "dev.tide", driver: "agent-device" })).rejects.toThrow(NOT_INSTALLED);
    expect(NOT_INSTALLED).toBe("agent-device is not installed; npm i -D agent-device, or drop --device to use Shipvo Phone");
    const d = agentDeviceDriver("dev.tide");
    const r = await d.open();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("npm i -D agent-device");
  });
});
