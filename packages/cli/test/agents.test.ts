import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsCmd, detectProject, upsertSection, mergeMcp, BEGIN, END } from "../src/agents";

const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-ag-"));
afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("detectProject", () => {
  it("tells the four kinds apart", () => {
    const pkg = (deps: object) => { const d = tmp(); writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: deps })); return d; };
    const s = tmp(); writeFileSync(join(s, "shipvo.json"), "{}");
    expect(detectProject(s)).toBe("shipvo");
    expect(detectProject(pkg({ expo: "1", "react-native": "1" }))).toBe("expo");
    expect(detectProject(pkg({ "react-native": "1" }))).toBe("react-native");
    expect(detectProject(pkg({ "@capacitor/core": "1" }))).toBe("capacitor");
    expect(detectProject(tmp())).toBe("unknown");
  });
});

describe("AGENTS.md", () => {
  it("creates the file when missing", async () => {
    quiet(); const d = tmp();
    expect(await agentsCmd(["setup"], d)).toBe(0);
    const t = readFileSync(join(d, "AGENTS.md"), "utf8");
    expect(t).toContain(BEGIN); expect(t).toContain("shipvo status --json");
  });
  it("appends, then updates only between the markers", () => {
    const before = "# Mine\n\nKeep me.\n";
    const a = upsertSection(before, `${BEGIN}\nold\n${END}`);
    expect(a.startsWith(before)).toBe(true);
    const wrapped = `top\n${a}\nbottom\n`;
    const b = upsertSection(wrapped, `${BEGIN}\nnew\n${END}`);
    expect(b).toBe(`top\n${before}\n${BEGIN}\nnew\n${END}\n\nbottom\n`);
    expect(b).not.toContain("old");
  });
  it("is idempotent", async () => {
    quiet(); const d = tmp();
    writeFileSync(join(d, "AGENTS.md"), "# Mine\n");
    await agentsCmd(["setup"], d);
    const files = [".mcp.json", "AGENTS.md"].map((f) => readFileSync(join(d, f), "utf8"));
    await agentsCmd(["setup"], d);
    expect([".mcp.json", "AGENTS.md"].map((f) => readFileSync(join(d, f), "utf8"))).toEqual(files);
    expect(files[1].startsWith("# Mine\n")).toBe(true);
  });
});

describe(".mcp.json", () => {
  it("keeps other servers and keys", () => {
    const out = JSON.parse(mergeMcp(JSON.stringify({ other: 1, mcpServers: { foo: { command: "x" } } }))!);
    expect(out.other).toBe(1); expect(out.mcpServers.foo).toEqual({ command: "x" });
    expect(out.mcpServers.shipvo.args).toContain("@shipvo/mcp");
  });
  it("returns null for invalid JSON and leaves the file alone", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {}); const d = tmp();
    writeFileSync(join(d, ".mcp.json"), "{nope");
    expect(await agentsCmd(["setup"], d)).toBe(2);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe("{nope");
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
  });
  it("writes .cursor/mcp.json only when .cursor exists", async () => {
    quiet(); const d = tmp();
    await agentsCmd(["setup"], d);
    expect(existsSync(join(d, ".cursor"))).toBe(false);
    mkdirSync(join(d, ".cursor"));
    await agentsCmd(["setup"], d);
    expect(JSON.parse(readFileSync(join(d, ".cursor/mcp.json"), "utf8")).mcpServers.shipvo).toBeTruthy();
  });
});

describe("flags", () => {
  it("--dry-run writes nothing; --json prints changes and the skill line", async () => {
    const log = quiet(); const d = tmp();
    expect(await agentsCmd(["setup", "--dry-run", "--json"], d)).toBe(0);
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
    const j = JSON.parse(String(log.mock.calls[0][0]));
    expect(j.dry_run).toBe(true); expect(j.changes.map((c: any) => c.action)).toEqual(["create", "create"]);
    expect(j.skill_install).toContain("skills add");
  });
});
