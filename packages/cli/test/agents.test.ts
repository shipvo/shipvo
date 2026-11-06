import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsCmd, skillStatus, detectProject, upsertSection, mergeMcp, BEGIN, END } from "../src/agents";

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
  it("leaves AGENTS.md alone and exits 2 when a marker is orphaned", async () => {
    quiet();
    for (const text of [`mine\n${BEGIN}\nold\nnotes\n`, `mine\n${END}\n${BEGIN}\n`, `${END}\nmine\n`]) {
      const d = tmp(); writeFileSync(join(d, "AGENTS.md"), text);
      expect(upsertSection(text, "x")).toBeNull();
      expect(await agentsCmd(["setup"], d)).toBe(2);
      expect(readFileSync(join(d, "AGENTS.md"), "utf8")).toBe(text);
      expect(existsSync(join(d, ".mcp.json"))).toBe(false);
    }
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

describe("package skills", () => {
  const project = (deps: string[], installed: string[] = deps) => {
    const d = tmp();
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: Object.fromEntries(deps.map((p) => [p, "1"])) }));
    for (const p of installed) {
      const n = `shipvo-${p.split("/")[1]}`;
      mkdirSync(join(d, "node_modules", p, "skills", n), { recursive: true });
      writeFileSync(join(d, "node_modules", p, "skills", n, "SKILL.md"), `---\nname: ${n}\n---\n`);
    }
    return d;
  };
  const dst = (d: string, n: string, base = ".agents/skills") => join(d, base, n, "SKILL.md");

  it("copies the skill of a dependency into a fresh project", async () => {
    quiet(); const d = project(["@shipvo/mcp"]);
    expect(await agentsCmd(["setup"], d)).toBe(0);
    expect(readFileSync(dst(d, "shipvo-mcp"), "utf8")).toContain("name: shipvo-mcp");
    expect(existsSync(dst(d, "shipvo-mcp", ".claude/skills"))).toBe(true);
    expect(skillStatus(d)).toEqual([{ package: "@shipvo/mcp", name: "shipvo-mcp", synced: true }]);
  });
  it("changes nothing on a second run", async () => {
    const log = quiet(); const d = project(["@shipvo/mcp"]);
    await agentsCmd(["setup"], d);
    log.mockClear();
    await agentsCmd(["setup", "--json"], d);
    const out = JSON.parse(String(log.mock.calls[0][0]));
    expect(out.changes.every((c: { action: string }) => c.action === "unchanged")).toBe(true);
  });
  it("updates a stale copy", async () => {
    quiet(); const d = project(["@shipvo/mcp"]);
    await agentsCmd(["setup"], d);
    writeFileSync(dst(d, "shipvo-mcp"), "old");
    expect(skillStatus(d)[0].synced).toBe(false);
    await agentsCmd(["skills-sync"], d);
    expect(skillStatus(d)[0].synced).toBe(true);
  });
  it("skips a package that is not a dependency", async () => {
    quiet(); const d = project(["@shipvo/mcp"], ["@shipvo/mcp", "@shipvo/test"]);
    await agentsCmd(["setup"], d);
    expect(existsSync(dst(d, "shipvo-test"))).toBe(false);
    const d2 = project(["@shipvo/test"], []);
    await agentsCmd(["setup"], d2);
    expect(existsSync(dst(d2, "shipvo-test"))).toBe(false);
    expect(skillStatus(d2)).toEqual([]);
  });
  it("writes nothing with --dry-run and lists what it would do", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}); const d = project(["@shipvo/mcp"]);
    await agentsCmd(["setup", "--dry-run", "--json"], d);
    const out = JSON.parse(String(log.mock.calls[0][0]));
    expect(out.changes.map((c: { file: string }) => c.file)).toContain(".agents/skills/shipvo-mcp/SKILL.md");
    expect(existsSync(join(d, ".agents"))).toBe(false);
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
  });
  it("skills sync touches only skills", async () => {
    quiet(); const d = project(["@shipvo/mcp"]);
    expect(await agentsCmd(["skills-sync"], d)).toBe(0);
    expect(existsSync(dst(d, "shipvo-mcp"))).toBe(true);
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(d, ".mcp.json"))).toBe(false);
  });
});

describe("skills shipped in the packages", () => {
  it.each(["mcp", "test", "runtime", "cli"])("@shipvo/%s has a SKILL.md and lists skills in files", (p) => {
    const root = join(__dirname, "../..", p);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.files).toContain("skills");
    expect(readFileSync(join(root, "skills", `shipvo-${p}`, "SKILL.md"), "utf8")).toMatch(new RegExp(`^---\\nname: shipvo-${p}\\ndescription: .+\\n---`));
  });
});
