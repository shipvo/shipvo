import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsCmd } from "../src/agents";
import { hostedEntry } from "../src/agents-hosted";

const URL_ = "https://sim.shipvo.dev/mcp", KEY = "sv_test_abcdefghijklmnop";
const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-hosted-"));
const git = (d: string, ...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
const repo = () => { const d = tmp(); git(d, "init", "-q"); git(d, "config", "user.email", "a@b.c"); git(d, "config", "user.name", "a"); return d; };
const creds = () => ({ key: KEY, control: "https://api.shipvo.dev", mcp_url: URL_ });
let out: string[] = [];
afterEach(() => vi.restoreAllMocks());
const run = async (dir: string, home: string, extra: string[] = [], deps: object = {}) => {
  out = []; vi.spyOn(console, "log").mockImplementation((s: string) => { out.push(String(s)); });
  const code = await agentsCmd(["setup", "--hosted", ...extra], dir, { home, creds, ...deps });
  return code;
};

describe("hosted entry per agent", () => {
  it("uses each agent's spelling with an Authorization header", () => {
    expect(hostedEntry("claude", URL_, KEY)).toEqual({ mcpServers: { shipvo: { type: "http", url: URL_, headers: { Authorization: `Bearer ${KEY}` } } } });
    expect(hostedEntry("cursor", URL_, KEY)).toEqual({ mcpServers: { shipvo: { url: URL_, headers: { Authorization: `Bearer ${KEY}` } } } });
    expect(hostedEntry("vscode", URL_, KEY)).toEqual({ servers: { shipvo: { type: "http", url: URL_, headers: { Authorization: `Bearer ${KEY}` } } } });
    expect(hostedEntry("windsurf", URL_, KEY)).toEqual({ mcpServers: { shipvo: { serverUrl: URL_, headers: { Authorization: `Bearer ${KEY}` } } } });
  });
});

describe("agents setup --hosted", () => {
  it("writes a git-ignored project file and user-level files, keeping other servers", async () => {
    const d = repo(), home = tmp();
    writeFileSync(join(d, ".gitignore"), ".mcp.json\n.vscode/mcp.json\n");
    writeFileSync(join(d, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    mkdirSync(join(d, ".vscode")); mkdirSync(join(home, ".cursor")); mkdirSync(join(home, ".codeium/windsurf"), { recursive: true });
    expect(await run(d, home)).toBe(0);
    const mcp = JSON.parse(readFileSync(join(d, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.other).toEqual({ command: "x" });
    expect(mcp.mcpServers.shipvo.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(readFileSync(join(d, ".vscode/mcp.json"), "utf8")).servers.shipvo.url).toBe(URL_);
    expect(JSON.parse(readFileSync(join(home, ".cursor/mcp.json"), "utf8")).mcpServers.shipvo.url).toBe(URL_);
    expect(JSON.parse(readFileSync(join(home, ".codeium/windsurf/mcp_config.json"), "utf8")).mcpServers.shipvo.serverUrl).toBe(URL_);
    expect(statSync(join(home, ".cursor/mcp.json")).mode & 0o077).toBe(0);
    // a second run changes nothing
    expect(await run(d, home)).toBe(0);
    expect(out.join("\n")).toContain(".mcp.json already up to date");
  });

  it("prints the block instead of writing when the project file is tracked by git", async () => {
    const d = repo(), home = tmp();
    const before = JSON.stringify({ mcpServers: { other: { command: "x" } } });
    writeFileSync(join(d, ".mcp.json"), before); git(d, "add", ".mcp.json"); git(d, "commit", "-qm", "x");
    expect(await run(d, home)).toBe(0);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe(before);
    const text = out.join("\n");
    expect(text).toContain("tracked by git");
    expect(text).toContain(`Bearer ${KEY}`);
  });

  it("prints instead of writing when the file is not git-ignored (or there is no repo)", async () => {
    const d = tmp(), home = tmp();
    expect(await run(d, home)).toBe(0);
    expect(existsSync(join(d, ".mcp.json"))).toBe(false);
    expect(out.join("\n")).toContain("not git-ignored");
  });

  it("gives ChatGPT the key-in-path URL", async () => {
    const d = tmp();
    await run(d, tmp(), ["--agent", "chatgpt"]);
    expect(out.join("\n")).toContain(`${URL_}/${KEY}`);
  });

  it("--dry-run writes nothing", async () => {
    const d = repo(), home = tmp(); mkdirSync(join(home, ".cursor"));
    writeFileSync(join(d, ".gitignore"), ".mcp.json\n");
    expect(await run(d, home, ["--dry-run"])).toBe(0);
    expect(existsSync(join(d, ".mcp.json"))).toBe(false);
    expect(existsSync(join(home, ".cursor/mcp.json"))).toBe(false);
  });

  it("runs the login flow first when there is no key", async () => {
    const d = repo(), home = tmp(); writeFileSync(join(d, ".gitignore"), ".mcp.json\n");
    let signedIn = false;
    const c = vi.fn(() => (signedIn ? creds() : null));
    expect(await run(d, home, [], { creds: c, login: async () => { signedIn = true; } })).toBe(0);
    expect(JSON.parse(readFileSync(join(d, ".mcp.json"), "utf8")).mcpServers.shipvo.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("fails without writing when sign-in does not finish", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(repo(), tmp(), [], { creds: () => null, login: async () => {} })).toBe(2);
  });

  it("leaves an invalid JSON file alone and exits 2", async () => {
    const d = repo(); writeFileSync(join(d, ".gitignore"), ".mcp.json\n"); writeFileSync(join(d, ".mcp.json"), "{nope");
    expect(await run(d, tmp())).toBe(2);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe("{nope");
  });
});
