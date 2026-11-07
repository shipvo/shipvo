// One command for the two-phones chess demo: `pnpm --filter chess demo` (add `-- --autoplay` to play a full game).
// Starts an Android phone and an iOS phone on the chess web build, and a page that shows them side by side.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { demoPage } from "./page.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

export async function startDemo({ port = 0 } = {}) {
  if (!existsSync(`${root}sim-dist/index.html`)) {
    execSync("pnpm exec expo export --platform web --output-dir sim-dist --clear", { cwd: root, env: { ...process.env, PN_SIM: "1" }, stdio: "inherit" });
  }
  const run = await import(require.resolve("@shipvo/cli/dist/run.js"));
  const render = await run.loadFrameRenderer([`${root}package.json`]);
  const phone = (platform) => run.startRunServer({ dir: `${root}sim-dist`, platform, name: "Chess", appId: "chess", render, port: 0 });
  const [android, ios] = await Promise.all([phone("android"), phone("ios")]);
  const html = demoPage({ android: `http://127.0.0.1:${android.port}/`, ios: `http://127.0.0.1:${ios.port}/` });
  const server = createServer((req, res) => {
    if ((req.url ?? "/").split("?")[0] !== "/") { res.writeHead(404); return void res.end("Not found"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const close = async () => { await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }); await android.close(); await ios.close(); };
  return { url, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--port");
  const demo = await startDemo({ port: pi >= 0 ? Number(args[pi + 1]) : 0 });
  const url = args.includes("--autoplay") ? `${demo.url}?autoplay=1` : demo.url;
  console.log(`Chess on Android and iOS: ${url}\nPress Ctrl+C to stop.`);
  if (!args.includes("--no-open")) run_open(url);
  process.on("SIGINT", () => demo.close().then(() => process.exit(0)));
}

function run_open(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { execSync(`${cmd} "${url}"`, { stdio: "ignore" }); } catch { /* the address is printed above */ }
}
