import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentDeviceDriver, openApp, parseSnapshot, toScreen, sizesOf, NOT_INSTALLED } from "../src/index.js";

// A fake `agent-device` that logs its arguments and answers `snapshot --json` with recorded output.
// Shape of `agent-device snapshot --json` as typed in agent-device 0.21.36 (`{ success, data: { nodes } }`, each node with `role`, `type`, `label`, `ref`, `rect`).
const SNAPSHOT = readFileSync(join(import.meta.dirname, "fixtures", "agent-device-snapshot.json"), "utf8");
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
const stdin = a.includes("--text-stdin") ? fs.readFileSync(0, "utf8") : undefined;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(stdin === undefined ? a : [...a, "stdin:" + stdin]) + "\\n");
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
    expect(calls()).toEqual(expect.arrayContaining([["fill", "@e4", "--text-stdin", "--platform", "android", "stdin:a@b.co\n"], ["scroll", "down", "--platform", "android"], ["back", "--platform", "android"]]));
    expect(Array.from(await phone.screenshot())).toEqual([137, 80, 78, 71]);
  });
  it("passes text that starts with a dash as data, not a flag", async () => {
    const phone = await openApp({ app: "dev.tide", driver: "agent-device" });
    await phone.type("Email", "--help");
    await phone.type("Email", "-5");
    const fills = calls().filter((c) => c[0] === "fill");
    expect(fills.map((c) => c.slice(-1)[0])).toEqual(["stdin:--help\n", "stdin:-5\n"]);
    expect(fills.every((c) => !c.includes("--help") && !c.includes("-5"))).toBe(true);
    const ad = (phone as unknown as { ad: { open(t: string): Promise<void> } }).ad;
    await expect(ad.open("--help")).rejects.toThrow(/cannot start with "-"/);
    expect(calls().some((c) => c[1] === "--help")).toBe(false);
  });
  it("gives a symbols-only kind the generic role", () => {
    expect(toScreen([{ ref: "e1", kind: "***", label: "" }])).toBe("- generic [ref=e1]");
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

describe("openApp driver selection", () => {
  const inDir = (json?: object) => {
    const d = mkdtempSync(join(tmpdir(), "ad-app-"));
    if (json) writeFileSync(join(d, "shipvo.json"), JSON.stringify(json));
    const prev = process.cwd(); process.chdir(d);
    return () => process.chdir(prev);
  };
  it("uses agent-device when opts.driver says so", async () => {
    const back = inDir();
    try { await openApp({ app: "dev.tide", driver: "agent-device" }); expect(calls()[0]![0]).toBe("open"); } finally { back(); }
  });
  it("uses agent-device when SHIPVO_DEVICE_DRIVER says so", async () => {
    const back = inDir(); process.env.SHIPVO_DEVICE_DRIVER = "agent-device";
    try { await openApp({ app: "dev.tide" }); expect(calls()[0]![0]).toBe("open"); } finally { back(); }
  });
  it("uses agent-device when shipvo.json has device: agent-device", async () => {
    const back = inDir({ appId: "dev.tide", device: "agent-device" });
    try { await openApp({}); expect(calls()[0]).toEqual(["open", "dev.tide", "--platform", "android"]); } finally { back(); }
  });
  it("lets opts.driver phone win over the env var", async () => {
    const back = inDir(); process.env.SHIPVO_DEVICE_DRIVER = "agent-device";
    try { await openApp({ app: "dev.tide", driver: "phone", sim: "http://127.0.0.1:1" }).catch(() => {}); expect(calls()).toEqual([]); } finally { back(); }
  });
});
