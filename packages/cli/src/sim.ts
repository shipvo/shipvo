// `shipvo sim`: build the app's web bundle with the simulated device and serve it in the simulator.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { args as parse, loadConfig } from "./config.js";

export async function sim(argv: string[]) {
  const a = parse(argv); const cfg = loadConfig();
  if (a["skip-build"] !== "true" || !existsSync("sim-dist/index.html")) {
    console.error(`Building ${cfg.name} for the simulator…`);
    execSync("PN_SIM=1 npx expo export --platform web --output-dir sim-dist --clear", { stdio: "inherit", env: { ...process.env, PN_SIM: "1" } });
  }
  let server: string;
  try { server = createRequire(process.cwd() + "/package.json").resolve("@shipvo/sim/server.mjs"); }
  catch { console.error("Install @shipvo/sim (and playwright) in this app: npm i -D @shipvo/sim playwright && npx playwright install chromium"); process.exit(2); }
  const port = a.port || "4545";
  console.error(`Simulator on http://localhost:${port}  (open_app("${cfg.appId}") from @shipvo/mcp; Ctrl-C to stop)`);
  const p = spawn(process.execPath, [server, "--port", port, "--app", cfg.appId, ...(a.dir ? ["--dir", a.dir] : [])], { stdio: "inherit", env: { ...process.env, PN_CONTROL: cfg.controlPlane } });
  p.on("exit", (c) => process.exit(c ?? 0));
}
