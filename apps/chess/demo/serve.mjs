// One command for the two-phones chess demo: `pnpm --filter chess demo` (add `-- --autoplay` to play a full game).
// Starts an Android phone and an iOS phone on the chess web build, and a page that shows them side by side.
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { demoPage } from "./page.mjs";
import { formatPgn } from "./pgn.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const MOVE_TIME_DEFAULT = 60_000;

/**
 * Starts the two phones and the page. With `agents`, each phone is a live run that @shipvo/mcp attaches to:
 * `agentDirs.white` and `agentDirs.black` hold the `.shipvo/run.json` of each phone, and an MCP server started in
 * that directory attaches to it. With `record`, the page is recorded to one video until the game ends.
 */
export async function startDemo({ port = 0, agents = false, moveTime = MOVE_TIME_DEFAULT, names = {}, record = false, outDir } = {}) {
  if (!existsSync(`${root}sim-dist/index.html`)) {
    execSync("pnpm exec expo export --platform web --output-dir sim-dist --clear", { cwd: root, env: { ...process.env, PN_SIM: "1" }, stdio: "inherit" });
  }
  const run = await import(require.resolve("@shipvo/cli/dist/run.js"));
  const render = await run.loadFrameRenderer([`${root}package.json`]);
  const out = outDir ?? mkdtempSync(join(tmpdir(), "shipvo-chess-"));
  const agentDirs = agents ? { white: join(out, "white"), black: join(out, "black") } : undefined;
  const phone = (platform, side) => run.startRunServer({ dir: `${root}sim-dist`, platform, name: "Chess", appId: "chess", render, port: 0, ...(agentDirs ? { projectDir: agentDirs[side] } : {}) });
  const [android, ios] = await Promise.all([phone("android", "white"), phone("ios", "black")]);
  const players = { white: names.white ?? "White agent", black: names.black ?? "Black agent" };
  const html = demoPage({ android: `http://127.0.0.1:${android.port}/`, ios: `http://127.0.0.1:${ios.port}/`, agents: agents ? { moveTime, ...players } : null });
  let game = { san: [], moves: [], over: false, result: null };
  let recording;
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/__game" && req.method === "POST") {
      let raw = "";
      for await (const c of req) raw += c;
      try { game = { ...game, ...JSON.parse(raw) }; } catch { /* keep the last good state */ }
      res.writeHead(204);
      res.end();
      if (game.over) void finishRecording();
      return;
    }
    if (path === "/game.pgn") {
      res.writeHead(200, { "content-type": "application/x-chess-pgn; charset=utf-8", "cache-control": "no-store" });
      return void res.end(pgn());
    }
    if (path !== "/") { res.writeHead(404); return void res.end("Not found"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  });
  const pgn = () => formatPgn({ san: game.san, result: game.result, white: players.white, black: players.black });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}/`;

  // Recording uses the recorder of @shipvo/mcp on the page, which holds both phones, the clocks, the names and the move list.
  let recordingDone, finishResolve;
  if (record) {
    const { Recorder } = await import(new URL("../../../packages/mcp/dist/recorder.js", import.meta.url).href);
    recording = new Recorder();
    await recording.start({ url, format: "16:9", title: "chess", dir: out });
    recordingDone = new Promise((ok) => { finishResolve = ok; });
  }
  async function finishRecording() {
    if (!recording || !recording.active) return;
    const rec = recording;
    await new Promise((r) => setTimeout(r, 1500)); // hold the final position on screen
    const file = join(out, "game.pgn");
    writeFileSync(file, pgn());
    try { finishResolve?.({ video: (await rec.stop({})).file, pgn: file }); } catch (e) { finishResolve?.({ error: e.message, pgn: file }); }
  }
  const close = async () => {
    if (recording?.active) await recording.stop({}).catch(() => {});
    await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    await android.close();
    await ios.close();
  };
  return { url, close, agentDirs, pgn, game: () => game, recorded: () => recordingDone };
}

/** The MCP config and the prompt for one side. The config starts @shipvo/mcp in the folder of that phone. */
export function agentSetup(side, dir) {
  const config = { mcpServers: { [`shipvo-${side}`]: { command: "sh", args: ["-c", `cd '${dir}' && exec npx -y @shipvo/mcp`] } } };
  const prompt = `You play ${side} in session ${side}. Call open_app with app "chess" and session "${side}". Read the board with get_board (the screen tool): it says whose turn it is and the last move. See legal_moves by tapping one of your pieces: the squares it can reach are labelled "legal move". Then move by tapping the target square. If it is not your turn, wait a few seconds and call get_board again. Keep playing until the game is over.`;
  return { config, prompt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const moveSeconds = opt("--move-time") === undefined ? undefined : Number(opt("--move-time"));
  if (moveSeconds !== undefined && !(Number.isFinite(moveSeconds) && moveSeconds > 0)) {
    console.error(`--move-time needs a positive number of seconds, got "${opt("--move-time")}".`);
    process.exit(1);
  }
  const agents = args.includes("--agents");
  const record = args.includes("--record");
  const demo = await startDemo({
    port: opt("--port") ? Number(opt("--port")) : 0,
    agents,
    record,
    moveTime: moveSeconds !== undefined ? moveSeconds * 1000 : MOVE_TIME_DEFAULT,
    names: { white: opt("--white-name"), black: opt("--black-name") },
  });
  const url = args.includes("--autoplay") ? `${demo.url}?autoplay=1` : demo.url;
  console.log(`Chess on Android and iOS: ${url}\nPress Ctrl+C to stop.`);
  if (agents) {
    for (const side of ["white", "black"]) {
      const { config, prompt } = agentSetup(side, demo.agentDirs[side]);
      console.log(`\n--- ${side} (${side === "white" ? "Android" : "iOS"}) ---\nMCP config:\n${JSON.stringify(config, null, 2)}\nPrompt:\n${prompt}`);
    }
    console.log(`\nWhen both assistants are connected, press "Start the clock" on the page. The game ends on checkmate, a draw or a move that takes longer than ${(opt("--move-time") ?? 60)} s.`);
  }
  if (record) {
    console.log("Recording the page. The video and the moves file (PGN) are written when the game ends.");
    demo.recorded().then((r) => { console.log(r.error ? `Recording failed: ${r.error}` : `Video: ${r.video}`); console.log(`Moves (PGN): ${r.pgn}`); });
  } else if (!args.includes("--no-open")) run_open(url);
  process.on("SIGINT", () => demo.close().then(() => process.exit(0)));
}

function run_open(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { execSync(`${cmd} "${url}"`, { stdio: "ignore" }); } catch { /* the address is printed above */ }
}
