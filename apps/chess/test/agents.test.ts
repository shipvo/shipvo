// Two scripted MCP clients (no AI) play fool's mate through @shipvo/mcp, each attached to its own phone by session name.
import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const { startDemo, agentSetup } = await import("../demo/serve.mjs");
const mcpServer = fileURLToPath(new URL("../../../packages/mcp/dist/server.js", import.meta.url));

/** A tiny stdio MCP client: one JSON message per line. */
class Mcp {
  private proc: ChildProcessWithoutNullStreams;
  private next = 1;
  private waiting = new Map<number, (m: any) => void>();
  constructor(cwd: string) {
    const env = { ...process.env, PN_SIM: "http://127.0.0.1:1", PN_CONTROL: "http://127.0.0.1:1" };
    this.proc = spawn(process.execPath, [mcpServer], { cwd, env });
    let buf = "";
    this.proc.stdout.on("data", (d) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); this.waiting.get(m.id)?.(m); } catch { /* not a reply */ }
      }
    });
  }
  private rpc(method: string, params: object): Promise<any> {
    const id = this.next++;
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`no reply to ${method}`)), 30_000);
      this.waiting.set(id, (m) => { clearTimeout(t); ok(m); });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async init() {
    await this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "scripted", version: "0" } });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  async call(name: string, args: object): Promise<string> {
    const m = await this.rpc("tools/call", { name, arguments: args });
    return (m.result?.content ?? []).map((c: any) => c.text).join("\n") || JSON.stringify(m.error ?? m);
  }
  close() { this.proc.kill(); }
}

/** One player: tap by the label the board shows, read the screen as get_board. */
class Player {
  constructor(private mcp: Mcp, readonly side: string) {}
  get_board() { return this.mcp.call("screen", { session: this.side }); }
  async tapSquare(label: string): Promise<string> {
    const screen = await this.get_board();
    const m = new RegExp(`"${label}[^"]*"[^\\n]*\\[ref=(e\\d+)\\]`).exec(screen);
    if (!m) throw new Error(`no square "${label}" on:\n${screen}`);
    return this.mcp.call("tap", { session: this.side, ref: m[1] });
  }
  /** Taps the piece, then the empty target square. */
  async move(piece: string, from: string, to: string): Promise<string> {
    await this.tapSquare(`${piece} on ${from}`);
    return this.tapSquare(`empty square ${to}`);
  }
  async until(text: string, ms = 20_000): Promise<string> {
    const end = Date.now() + ms;
    let s = "";
    while (Date.now() < end) { s = await this.get_board(); if (s.includes(text)) return s; await new Promise((r) => setTimeout(r, 300)); }
    throw new Error(`"${text}" never showed on:\n${s}`);
  }
}

let demo: Awaited<ReturnType<typeof startDemo>>;
let browser: import("playwright").Browser;
let page: import("playwright").Page;
const clients: Mcp[] = [];

beforeAll(async () => {
  expect(existsSync(mcpServer), "build @shipvo/mcp first: pnpm -r build").toBe(true);
  demo = await startDemo({ port: 0, agents: true, moveTime: 0, names: { white: "Claude", black: "ChatGPT" } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(demo.url);
  await page.frameLocator("#phone-white").frameLocator("#app").getByTestId("board").waitFor({ timeout: 110_000 });
  await page.frameLocator("#phone-black").frameLocator("#app").getByTestId("board").waitFor({ timeout: 110_000 });
}, 240_000);
afterAll(async () => {
  clients.forEach((c) => c.close());
  await browser?.close();
  await demo?.close();
});

it("prints a config and a prompt for each side", () => {
  const { config, prompt } = agentSetup("white", "/tmp/x");
  expect(JSON.stringify(config)).toContain("@shipvo/mcp");
  expect(prompt).toContain("You play white in session white.");
});

it("plays fool's mate through two attached sessions, refuses out-of-turn moves and records the PGN", async () => {
  const open = async (side: "white" | "black") => {
    const mcp = new Mcp(demo.agentDirs![side]);
    clients.push(mcp);
    await mcp.init();
    const text = await mcp.call("open_app", { app: "chess", session: side, attach: "always" });
    expect(text).toContain("attached to the live shipvo run phone");
    return new Player(mcp, side);
  };
  const white = await open("white");
  const black = await open("black");

  const start = await white.get_board();
  expect(start).toContain("Turn: white. No moves yet. You play white.");

  // Black moves first: refused, with the reason on screen, and nothing moves.
  const early = await black.tapSquare("black pawn on e7");
  expect(early).toContain("It is white's turn. You play black.");
  expect(await white.get_board()).toContain("No moves yet.");

  // 1. f3
  await white.move("white pawn", "f2", "f3");
  await black.until("Last move: f2f3");
  // White again, out of turn.
  expect(await white.tapSquare("white pawn on g2")).toContain("It is black's turn. You play white.");
  // 1... e5
  await black.move("black pawn", "e7", "e5");
  await white.until("Last move: e7e5");
  // 2. g4 Qh4#
  await white.move("white pawn", "g2", "g4");
  await black.until("Last move: g2g4");
  await black.move("black queen", "d8", "h4");

  const end = await white.until("Checkmate, black wins");
  expect(end).toContain("The game is over.");
  await expect(page.locator("#result").textContent()).resolves.toBe("Checkmate, black wins");
  await expect(page.locator("[data-part=name-white]").textContent()).resolves.toContain("Claude");
  await expect(page.locator("[data-part=name-black]").textContent()).resolves.toContain("ChatGPT");
  await expect(page.locator("#moves").textContent()).resolves.toBe("1. f3e52. g4Qh4#");

  // The page reports the game to the server; the PGN comes from the same moves.
  await expect.poll(() => demo.game().over, { timeout: 10_000 }).toBe(true);
  const pgn = await (await fetch(`${demo.url}game.pgn`)).text();
  expect(pgn).toContain('[White "Claude"]');
  expect(pgn).toContain('[Black "ChatGPT"]');
  expect(pgn).toContain('[Result "0-1"]');
  expect(pgn.trim().split("\n").at(-1)).toBe("1. f3 e5 2. g4 Qh4# 0-1");
}, 180_000);

it("ends the game when a side takes longer than the move time", async () => {
  const short = await startDemo({ port: 0, agents: true, moveTime: 1500 });
  try {
    const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await p.goto(short.url);
    const white = p.frameLocator("#phone-white").frameLocator("#app");
    await white.getByTestId("board").waitFor({ timeout: 60_000 });
    await p.frameLocator("#phone-black").frameLocator("#app").getByTestId("board").waitFor({ timeout: 60_000 });
    await p.locator("#start").click();
    await p.locator("#result").filter({ hasText: "Time out, black wins" }).waitFor({ timeout: 15_000 });
    await white.getByTestId("status").filter({ hasText: "Time out, black wins" }).waitFor({ timeout: 10_000 });
    await expect.poll(() => short.game().over, { timeout: 10_000 }).toBe(true);
    const pgn = await (await fetch(`${short.url}game.pgn`)).text();
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Termination "time forfeit"]');
    await p.close();
  } finally {
    await short.close();
  }
}, 120_000);
