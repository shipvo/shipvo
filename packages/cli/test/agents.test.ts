import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsSetup, updateAgentsMd, agentsSection, mergeMcp, detectProject, BEGIN, END } from "../src/agents";
import { status, type StatusDeps } from "../src/status";

afterEach(() => vi.restoreAllMocks());
const tmp = () => mkdtempSync(join(tmpdir(), "shipvo-agents-"));
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("AGENTS.md section", () => {
  it("creates the file when missing", () => {
    const out = updateAgentsMd(null, agentsSection("expo"));
    expect(out.startsWith(BEGIN)).toBe(true);
    expect(out).toContain("@shipvo/cli status --json");
  });
  it("appends after existing text and leaves it alone", () => {
    const out = updateAgentsMd("# Mine\n\nKeep this.\n", agentsSection("expo"));
    expect(out.startsWith("# Mine\n\nKeep this.\n\n" + BEGIN)).toBe(true);
  });
  it("replaces only the marked section", () => {
    const first = updateAgentsMd("before\n", agentsSection("expo")) + "after text\n";
    const second = updateAgentsMd(first, agentsSection("capacitor"));
    expect(second.startsWith("before\n")).toBe(true);
    expect(second.endsWith("after text\n")).toBe(true);
    expect(second).toContain("detected: capacitor");
    expect(second).not.toContain("detected: expo");
    expect(second.split(BEGIN).length).toBe(2);
    expect(second.split(END).length).toBe(2);
  });
});

describe(".mcp.json merge", () => {
  it("keeps other servers and keys", () => {
    const out = JSON.parse(mergeMcp(JSON.stringify({ x: 1, mcpServers: { other: { url: "u" } } }))!);
    expect(out.x).toBe(1);
    expect(out.mcpServers.other).toEqual({ url: "u" });
    expect(out.mcpServers.shipvo.args).toContain("@shipvo/mcp");
  });
  it("keeps an existing shipvo entry and rejects bad JSON", () => {
    const own = { mcpServers: { shipvo: { url: "https://mine" } } };
    expect(JSON.parse(mergeMcp(JSON.stringify(own))!)).toEqual(own);
    expect(mergeMcp("{nope")).toBeNull();
  });
});

describe("shipvo agents setup", () => {
  it("detects the project kind", () => {
    const d = tmp();
    expect(detectProject(d)).toBe("unknown");
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { "react-native": "1" } }));
    expect(detectProject(d)).toBe("react-native");
    writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { expo: "1", "react-native": "1" } }));
    expect(detectProject(d)).toBe("expo");
    writeFileSync(join(d, "capacitor.config.ts"), "");
    expect(detectProject(d)).toBe("capacitor");
    writeFileSync(join(d, "shipvo.json"), "{}");
    expect(detectProject(d)).toBe("shipvo");
  });
  it("writes files, adds .cursor/mcp.json only if .cursor exists, and is idempotent", () => {
    const d = tmp(); mkdirSync(join(d, ".cursor"));
    quiet();
    expect(agentsSetup(["setup"], d)).toBe(0);
    for (const f of ["AGENTS.md", ".mcp.json", ".cursor/mcp.json"]) expect(existsSync(join(d, f))).toBe(true);
    const snap = ["AGENTS.md", ".mcp.json", ".cursor/mcp.json"].map((f) => readFileSync(join(d, f), "utf8"));
    const log = quiet();
    log.mockClear();
    expect(agentsSetup(["setup", "--json"], d)).toBe(0);
    const res = JSON.parse(String(log.mock.calls[0][0]));
    expect(res.files.map((f: any) => f.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(["AGENTS.md", ".mcp.json", ".cursor/mcp.json"].map((f) => readFileSync(join(d, f), "utf8"))).toEqual(snap);
  });
  it("skips .cursor/mcp.json without .cursor", () => {
    const d = tmp(); quiet();
    agentsSetup(["setup"], d);
    expect(existsSync(join(d, ".cursor"))).toBe(false);
  });
  it("--dry-run writes nothing", () => {
    const d = tmp(); const log = quiet();
    expect(agentsSetup(["setup", "--dry-run", "--json"], d)).toBe(0);
    expect(existsSync(join(d, "AGENTS.md"))).toBe(false);
    expect(JSON.parse(String(log.mock.calls[0][0])).files[0].action).toBe("created");
  });
  it("does not overwrite an invalid .mcp.json and exits 1", () => {
    const d = tmp(); quiet();
    writeFileSync(join(d, ".mcp.json"), "{bad");
    expect(agentsSetup(["setup"], d)).toBe(1);
    expect(readFileSync(join(d, ".mcp.json"), "utf8")).toBe("{bad");
  });
});

describe("shipvo status --json", () => {
  const deps = (dir: string, over: Partial<StatusDeps> = {}): StatusDeps => ({ dir, probe: async () => false, alive: () => false, ...over });
  const app = (extra: Record<string, string> = {}) => {
    const d = tmp();
    writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test", publicKey: "k" }));
    for (const [k, v] of Object.entries(extra)) { mkdirSync(join(d, k, ".."), { recursive: true }); writeFileSync(join(d, k), v); }
    return d;
  };
  const run = async (d: string, f: any, over: Partial<StatusDeps> = {}) => {
    const log = quiet(); log.mockClear();
    const code = await status(["--json"], f, deps(d, over));
    return { code, doc: JSON.parse(String(log.mock.calls[0][0])) };
  };
  const cp = (b: unknown, st = 200) => (async () => new Response(JSON.stringify(b), { status: st })) as any;
  const old = { ...process.env };
  afterEach(() => { process.env = { ...old }; });

  it("non-Shipvo Expo app: action needed, next is init, exit 1", async () => {
    const d = tmp(); writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { expo: "1" } }));
    const { code, doc } = await run(d, cp({}));
    expect(code).toBe(1);
    expect(doc.ok).toBe(false);
    expect(doc.code).toBe("action_needed");
    expect(doc.data.project).toEqual({ kind: "expo", app_id: null });
    expect(doc.next[0].command).toContain("init");
    expect(Object.keys(doc.data).sort()).toEqual(["pending_release", "project", "run_server", "signing_key", "sim", "store_step"]);
  });
  it("new Shipvo app with no key and nothing published: key first, then dry run and sim", async () => {
    delete process.env.SHIPVO_SIGNING_SEED; delete process.env.SHIPVO_SIGNING_SEED_FILE; delete process.env.PURENATIVE_SIGNING_SEED; delete process.env.PURENATIVE_SIGNING_SEED_FILE;
    const { code, doc } = await run(app(), cp({ releases: [] }));
    expect(code).toBe(1);
    expect(doc.data.signing_key).toEqual({ present: false, source: "none" });
    expect(doc.next.map((n: any) => n.command.split(" ")[3])).toEqual(["keys", "sim"]);
  });
  it("key present, nothing published: suggests a publish dry run", async () => {
    const { doc } = await run(app({ ".shipvo/seed.txt": "s" }), cp({ releases: [] }));
    expect(doc.data.signing_key.source).toBe("file");
    expect(doc.next[0].command).toContain("publish --dry-run");
  });
  it("halted release: next is rollback", async () => {
    const halted = { release: 8, reports: 40, failed: 12, threshold: 0.2 };
    const { doc } = await run(app({ ".shipvo/seed.txt": "s" }), cp({ releases: [{ release: 8, events: {}, apply_ms_median: null, cold_start_ms_median: null }], halted }), { probe: async () => true });
    expect(doc.data.pending_release).toEqual({ latest: 8, halted: 8, dry_run_ready: false });
    expect(doc.next[0].command).toBe("npx -y @shipvo/cli rollback --to 7");
    expect(doc.data.sim.running).toBe(true);
  });
  it("everything fine: ok true, exit 0, no next", async () => {
    const d = app({ ".shipvo/seed.txt": "s", ".shipvo/run.json": JSON.stringify({ pid: 1, port: 5000 }) });
    const { code, doc } = await run(d, cp({ releases: [{ release: 3, events: {}, apply_ms_median: null, cold_start_ms_median: null }] }), { alive: () => true });
    expect(code).toBe(0);
    expect(doc).toMatchObject({ ok: true, code: "ok", next: [] });
    expect(doc.data.run_server).toEqual({ running: true, port: 5000 });
  });
  it("unreachable control plane points at doctor", async () => {
    const { code, doc } = await run(app({ ".shipvo/seed.txt": "s" }), (async () => { throw new TypeError("fetch failed"); }) as any, { probe: async () => true });
    expect(code).toBe(1);
    expect(doc.next[0].command).toContain("doctor");
  });
  it("a store plan adds the next store step", async () => {
    const plan = { version: 1, answers: { company: false, androidNow: false, playAccountBefore20231113: false }, marks: {} };
    const { doc } = await run(app({ ".shipvo/seed.txt": "s", "store-plan.json": JSON.stringify(plan) }), cp({ releases: [{ release: 1, events: {}, apply_ms_median: null, cold_start_ms_median: null }] }), { probe: async () => true });
    expect(doc.data.store_step).toMatchObject({ id: expect.any(String) });
    expect(doc.next.at(-1).command).toContain("store status");
  });
  it("a broken shipvo.json is exit 2 with code error", async () => {
    const d = tmp(); writeFileSync(join(d, "shipvo.json"), "{}");
    const { code, doc } = await run(d, cp({}));
    expect(code).toBe(2);
    expect(doc).toMatchObject({ ok: false, code: "error" });
  });
});
