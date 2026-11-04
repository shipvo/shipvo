// `shipvo sim`: build the app's web bundle with the simulated device and serve it in the simulator.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, connect } from "node:net";
import { args as parse, loadConfig } from "./config.js";

/** True if nothing is listening on the port (checks by binding, then closing). */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

/** Resolves true once something accepts connections on the port, false if `stop` says to give up. */
function waitListening(port: number, stop: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (stop()) return resolve(false);
      const c = connect(port, "127.0.0.1");
      c.once("connect", () => { c.destroy(); resolve(true); });
      c.once("error", () => { c.destroy(); setTimeout(tryOnce, 100); });
    };
    tryOnce();
  });
}

export async function sim(argv: string[]) {
  const a = parse(argv); const cfg = loadConfig();
  const port = a.port || "4545";
  if (!(await portFree(Number(port)))) {
    console.error(`Port ${port} is in use. Stop the other \`shipvo sim\` or pass --port <n>.`);
    process.exit(1);
  }
  if (a["skip-build"] !== "true" || !existsSync("sim-dist/index.html")) {
    console.error(`Building ${cfg.name} for the simulator…`);
    execSync("PN_SIM=1 npx expo export --platform web --output-dir sim-dist --clear", { stdio: "inherit", env: { ...process.env, PN_SIM: "1" } });
  }
  let server: string;
  try { server = createRequire(process.cwd() + "/package.json").resolve("@shipvo/sim/server.mjs"); }
  catch { console.error("Install @shipvo/sim (and playwright) in this app: npm i -D @shipvo/sim playwright && npx playwright install chromium"); process.exit(2); }
  const p = spawn(process.execPath, [server, "--port", port, "--app", cfg.appId, ...(a.dir ? ["--dir", a.dir] : [])], { stdio: "inherit", env: { ...process.env, PN_CONTROL: cfg.controlPlane } });
  let exited = false;
  p.on("exit", (c) => { exited = true; process.exit(c ?? 0); });
  if (await waitListening(Number(port), () => exited)) {
    console.error(`Simulator on http://localhost:${port}  (open_app("${cfg.appId}") from @shipvo/mcp; Ctrl-C to stop)`);
  }
}
