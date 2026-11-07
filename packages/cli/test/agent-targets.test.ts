import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsCmd } from "../src/agents";
import { mergeToml, codexBlock, TARGETS } from "../src/agent-targets";

const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-at-"));
afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});
const run = (argv: string[], d: string, home = tmp()) => agentsCmd(argv, d, home, "");
const rd = (d: string, f: string) => JSON.parse(readFileSync(join(d, f), "utf8"));

const JSON_FORMATS: [string, string, string[], (j: any) => any][] = [
  ["claude", ".mcp.json", ["mcpServers"], (j) => j.mcpServers],
  ["cursor", ".cursor/mcp.json", ["mcpServers"], (j) => j.mcpServers],
  ["vscode", ".vscode/mcp.json", ["servers"], (j) => j.servers],
  ["gemini", ".gemini/settings.json", ["mcpServers"], (j) => j.mcpServers],
  ["qwen", ".qwen/settings.json", ["mcpServers"], (j) => j.mcpServers],
  ["roo", ".roo/mcp.json", ["mcpServers"], (j) => j.mcpServers],
  ["kiro", ".kiro/settings/mcp.json", ["mcpServers"], (j) => j.mcpServers],
  ["opencode", "opencode.json", ["mcp"], (j) => j.mcp],
];

describe.each(JSON_FORMATS)("%s", (id, file, _p, servers) => {
  it("creates a new file", async () => {
    quiet(); const d = tmp();
    expect(await run(["setup", "--for", id], d)).toBe(0);
    const s = servers(rd(d, file)).shipvo;
    if (id === "opencode") expect(s).toEqual({ type: "local", command: ["npx", "-y", "@shipvo/mcp"], environment: {} });
    else if (id === "vscode") expect(s).toEqual({ type: "stdio", command: "npx", args: ["-y", "@shipvo/mcp"] });
    else expect(s).toEqual({ command: "npx", args: ["-y", "@shipvo/mcp"] });
  });
  it("keeps another server and other keys", async () => {
    quiet(); const d = tmp();
    mkdirSync(join(d, file, ".."), { recursive: true });
    const key = id === "vscode" ? "servers" : id === "opencode" ? "mcp" : "mcpServers";
    writeFileSync(join(d, file), JSON.stringify({ theme: "x", [key]: { other: { command: "y" } } }));
    await run(["setup", "--for", id], d);
    const j = rd(d, file);
    expect(j.theme).toBe("x"); expect(servers(j).other).toEqual({ command: "y" }); expect(servers(j).shipvo).toBeTruthy();
  });
  it("leaves a broken file alone with a clear message", async () => {
    const log = quiet(); const d = tmp();
    mkdirSync(join(d, file, ".."), { recursive: true });
    writeFileSync(join(d, file), "{nope");
    expect(await run(["setup", "--for", id], d)).toBe(2);
    expect(readFileSync(join(d, file), "utf8")).toBe("{nope");
    expect(log.mock.calls.flat().join("\n")).toContain("left it alone");
  });
});

describe("Codex TOML", () => {
  const other = `model = "x"\n\n[mcp_servers.keep]\ncommand = "a"\n\n[mcp_servers.shipvo]\ncommand = "old"\n\n[mcp_servers.shipvo.env]\nK = "v"\n\n[profiles.p]\nmodel = "z"\n`;
  it("keeps other tables and replaces only ours", () => {
    const out = mergeToml(other, codexBlock());
    expect(out).toContain('model = "x"'); expect(out).toContain("[mcp_servers.keep]\ncommand = \"a\"");
    expect(out).toContain("[profiles.p]\nmodel = \"z\"");
    expect(out).not.toContain("old"); expect(out).not.toContain('K = "v"');
    expect(out.match(/\[mcp_servers\.shipvo\]/g)).toHaveLength(1);
    expect(mergeToml(out, codexBlock())).toBe(out);
  });
  it("appends to a file without our table", () => {
    const out = mergeToml('a = 1\n[t]\nb = 2\n', codexBlock());
    expect(out.startsWith('a = 1\n[t]\nb = 2\n\n[mcp_servers.shipvo]')).toBe(true);
  });
  it("is written with --global and printed without", async () => {
    const log = quiet(); const d = tmp(), home = tmp();
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex/config.toml"), "[mcp_servers.keep]\ncommand = \"a\"\n");
    await run(["setup", "--for", "codex"], d, home);
    expect(readFileSync(join(home, ".codex/config.toml"), "utf8")).not.toContain("shipvo");
    expect(log.mock.calls.flat().join("\n")).toContain("[mcp_servers.shipvo]");
    await run(["setup", "--for", "codex", "--global"], d, home);
    const t = readFileSync(join(home, ".codex/config.toml"), "utf8");
    expect(t).toContain("[mcp_servers.keep]"); expect(t).toContain("[mcp_servers.shipvo]");
  });
});

describe("Windsurf and print-only agents", () => {
  it("windsurf is written to the user file only with --global", async () => {
    quiet(); const d = tmp(), home = tmp();
    await run(["setup", "--for", "windsurf"], d, home);
    expect(existsSync(join(home, ".codeium/windsurf/mcp_config.json"))).toBe(false);
    await run(["setup", "--for", "windsurf", "--global"], d, home);
    expect(rd(home, ".codeium/windsurf/mcp_config.json").mcpServers.shipvo).toBeTruthy();
  });
  it("print-only agents write nothing and show a block", async () => {
    const log = quiet(); const d = tmp(), home = tmp();
    await run(["setup", "--all", "--global"], d, home);
    const out = log.mock.calls.flat().join("\n");
    for (const n of ["Claude Desktop", "Cline", "Zed", "Goose", "Continue", "Amp"]) expect(out).toContain(n);
    expect(existsSync(join(home, "claude_desktop_config.json"))).toBe(false);
  });
});

describe("detection, --dry-run, --json", () => {
  it("writes a detected agent by default and says how to add the others", async () => {
    const log = quiet(); const d = tmp();
    mkdirSync(join(d, ".kiro"));
    await run(["setup", "--json"], d);
    const j = JSON.parse(String(log.mock.calls[0][0]));
    const act = Object.fromEntries(j.agents.map((a: any) => [a.agent, a]));
    expect(act.kiro.action).toBe("written");
    expect(act.cursor.action).toBe("not-found"); expect(act.cursor.note).toContain("--for cursor");
    expect(existsSync(join(d, ".cursor"))).toBe(false);
  });
  it("detects a CLI on PATH", async () => {
    quiet(); const d = tmp(), bin = tmp();
    writeFileSync(join(bin, "gemini"), "");
    await agentsCmd(["setup"], d, tmp(), bin);
    expect(existsSync(join(d, ".gemini/settings.json"))).toBe(true);
  });
  it("--all writes every project file; second run is up to date", async () => {
    const log = quiet(); const d = tmp();
    await run(["setup", "--all"], d);
    for (const [, f] of JSON_FORMATS) expect(existsSync(join(d, f))).toBe(true);
    log.mockClear();
    await run(["setup", "--all", "--json"], d);
    const j = JSON.parse(String(log.mock.calls[0][0]));
    expect(j.agents.filter((a: any) => TARGETS.find((t) => t.id === a.agent)!.level === "project").every((a: any) => a.action === "up-to-date")).toBe(true);
  });
  it("--dry-run writes nothing; --json lists every agent", async () => {
    const log = quiet(); const d = tmp(), home = tmp();
    expect(await run(["setup", "--all", "--global", "--dry-run", "--json"], d, home)).toBe(0);
    expect(existsSync(join(d, ".cursor"))).toBe(false);
    expect(existsSync(join(home, ".codex"))).toBe(false);
    const j = JSON.parse(String(log.mock.calls[0][0]));
    expect(j.agents.map((a: any) => a.agent)).toEqual(TARGETS.map((t) => t.id));
    expect(j.agents.every((a: any) => a.action)).toBe(true);
  });
  it("rejects an unknown --for name", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(["setup", "--for", "nope"], tmp())).toBe(2);
  });
});
