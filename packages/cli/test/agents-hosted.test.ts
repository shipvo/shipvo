import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { agentsCmd } from "../src/agents";
import { TARGETS, remoteBlockFor } from "../src/agent-targets";

const KEY = "pn_live_SECRETKEY123";
const URL = "https://sim.example/mcp";
const creds = () => ({ key: KEY, mcp_url: URL });
const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-hosted-"));
afterEach(() => vi.restoreAllMocks());
const capture = () => { const out: string[] = []; vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); }); vi.spyOn(console, "error").mockImplementation((...a) => { out.push(a.join(" ")); }); return out; };
const run = (d: string, h: string, extra: string[] = []) => agentsCmd(["setup", "--hosted", "--all", ...extra], d, h, "", { creds });

describe("remote forms", () => {
  for (const t of TARGETS) {
    it(`${t.id}: ${t.remote!.path ? "path" : "header"} form`, () => {
      const b = remoteBlockFor(t, { url: URL, key: KEY });
      expect(b).toContain(URL);
      expect(b).toContain(KEY);
      if (t.remote!.path) expect(b).toContain(`${URL}/${KEY}`);
      else expect(b).toContain(`Bearer ${KEY}`);
    });
  }
});

describe("agents setup --hosted", () => {
  it("writes header forms into git-ignored project files and user files", async () => {
    const out = capture(); const d = tmp(), h = tmp();
    execFileSync("git", ["init", "-q"], { cwd: d });
    writeFileSync(join(d, ".gitignore"), ".mcp.json\n.cursor/\n.vscode/\n.gemini/\n.qwen/\n.roo/\n.kiro/\nopencode.json\n");
    expect(await run(d, h)).toBe(0);
    const mcp = JSON.parse(readFileSync(join(d, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.shipvo).toEqual({ type: "http", url: URL, headers: { Authorization: `Bearer ${KEY}` } });
    expect(JSON.parse(readFileSync(join(d, ".gemini/settings.json"), "utf8")).mcpServers.shipvo.httpUrl).toBe(URL);
    expect(readFileSync(join(h, ".codex/config.toml"), "utf8")).toContain(`Bearer ${KEY}`);
    expect(JSON.parse(readFileSync(join(h, ".codeium/windsurf/mcp_config.json"), "utf8")).mcpServers.shipvo.serverUrl).toBe(URL);
    expect(out.join("\n")).not.toContain(KEY);
  });

  it("prints the path form for agents that cannot send headers, without the key", async () => {
    const out = capture(); const d = tmp(), h = tmp();
    await run(d, h);
    const text = out.join("\n");
    expect(text).toContain(`${URL}/<your Shipvo key>`);
    expect(text).not.toContain(KEY);
  });

  it("never writes a git-tracked project file; prints the block with the reason", async () => {
    const out = capture(); const d = tmp(), h = tmp();
    execFileSync("git", ["init", "-q"], { cwd: d });
    writeFileSync(join(d, ".mcp.json"), "{}\n");
    execFileSync("git", ["add", ".mcp.json"], { cwd: d });
    expect(await run(d, h)).toBe(0);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe("{}\n");
    const text = out.join("\n");
    expect(text).toContain(".mcp.json is tracked by git");
    expect(text).toContain("mcpServers");
    expect(text).not.toContain(KEY);
  });

  it("does not write a project file that git would pick up", async () => {
    capture(); const d = tmp(), h = tmp();
    execFileSync("git", ["init", "-q"], { cwd: d });
    await run(d, h);
    expect(existsSync(join(d, ".mcp.json"))).toBe(false);
  });

  it("signs in first when there is no key, then writes", async () => {
    capture(); const d = tmp(), h = tmp();
    const login = vi.fn(async () => creds());
    expect(await agentsCmd(["setup", "--hosted", "--for", "codex"], d, h, "", { creds: () => null, login })).toBe(0);
    expect(login).toHaveBeenCalledOnce();
    expect(existsSync(join(h, ".codex/config.toml"))).toBe(true);
  });

  it("writes nothing when sign-in fails", async () => {
    capture(); const d = tmp(), h = tmp();
    expect(await agentsCmd(["setup", "--hosted", "--for", "codex"], d, h, "", { creds: () => null, login: async () => null })).toBe(2);
    expect(existsSync(join(h, ".codex/config.toml"))).toBe(false);
  });

  it("--json and --dry-run leak no key and write nothing", async () => {
    const out = capture(); const d = tmp(), h = tmp();
    expect(await run(d, h, ["--json", "--dry-run"])).toBe(0);
    expect(out.join("\n")).not.toContain(KEY);
    expect(existsSync(join(d, ".mcp.json"))).toBe(false);
  });
});
