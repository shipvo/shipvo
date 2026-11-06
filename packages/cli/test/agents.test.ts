import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsCmd, applyAgentsSection, agentsSection, mergeMcpConfig, detectProject, AGENTS_BEGIN, AGENTS_END } from "../src/agents";

const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-agents-"));
afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("AGENTS.md section", () => {
  const sec = agentsSection("expo");
  it("creates the file when missing", () => {
    const t = applyAgentsSection(null, sec);
    expect(t).toContain(AGENTS_BEGIN);
    expect(t).toContain("shipvo status --json");
  });
  it("appends after existing text and leaves it alone", () => {
    const t = applyAgentsSection("# Mine\n\nKeep this.\n", sec);
    expect(t.startsWith("# Mine\n\nKeep this.\n")).toBe(true);
    expect(t).toContain(AGENTS_END);
  });
  it("updates only between the markers", () => {
    const old = `before\n${AGENTS_BEGIN}\nold text\n${AGENTS_END}\nafter\n`;
    const t = applyAgentsSection(old, sec);
    expect(t.startsWith("before\n")).toBe(true);
    expect(t.endsWith("\nafter\n")).toBe(true);
    expect(t).not.toContain("old text");
  });
  it("is idempotent", () => {
    const once = applyAgentsSection("# Mine\n", sec);
    expect(applyAgentsSection(once, sec)).toBe(once);
  });
});

describe("MCP config merge", () => {
  it("keeps other servers and keys", () => {
    const out = JSON.parse(mergeMcpConfig(JSON.stringify({ x: 1, mcpServers: { other: { url: "u" } } })));
    expect(out.x).toBe(1);
    expect(out.mcpServers.other).toEqual({ url: "u" });
    expect(out.mcpServers.shipvo).toEqual({ command: "npx", args: ["-y", "@shipvo/mcp"] });
  });
  it("rejects invalid JSON", () => { expect(() => mergeMcpConfig("{nope")).toThrow(); });
});

describe("shipvo agents setup", () => {
  it("writes AGENTS.md and .mcp.json, then changes nothing the second time", async () => {
    const d = tmp(); quiet();
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { expo: "52" } }));
    expect(await agentsCmd(["setup"], d)).toBe(0);
    const a = readFileSync(join(d, "AGENTS.md"), "utf8"), m = readFileSync(join(d, ".mcp.json"), "utf8");
    expect(a).toContain("an Expo app");
    expect(existsSync(join(d, ".cursor"))).toBe(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await agentsCmd(["setup", "--json"], d)).toBe(0);
    const out = JSON.parse(String(log.mock.calls[0][0]));
    expect(out.files.map((f: any) => f.action)).toEqual(["unchanged", "unchanged"]);
    expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe(a);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe(m);
  });
  it("also writes .cursor/mcp.json when .cursor exists", async () => {
    const d = tmp(); quiet(); mkdirSync(join(d, ".cursor"));
    await agentsCmd(["setup"], d);
    expect(JSON.parse(readFileSync(join(d, ".cursor", "mcp.json"), "utf8")).mcpServers.shipvo).toBeTruthy();
  });
  it("--dry-run writes nothing", async () => {
    const d = tmp(); quiet();
    expect(await agentsCmd(["setup", "--dry-run"], d)).toBe(0);
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(d, ".mcp.json"))).toBe(false);
  });
  it("leaves a broken .mcp.json untouched and exits 2", async () => {
    const d = tmp(); quiet(); vi.spyOn(console, "log");
    writeFileSync(join(d, ".mcp.json"), "{nope");
    expect(await agentsCmd(["setup"], d)).toBe(2);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe("{nope");
  });
  it("detects project kinds", () => {
    const d = tmp();
    expect(detectProject(d)).toBe("unknown");
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { "react-native": "0.76" } }));
    expect(detectProject(d)).toBe("react-native");
    writeFileSync(join(d, "capacitor.config.ts"), "");
    expect(detectProject(d)).toBe("capacitor");
    writeFileSync(join(d, "shipvo.json"), "{}");
    expect(detectProject(d)).toBe("shipvo");
  });
});
