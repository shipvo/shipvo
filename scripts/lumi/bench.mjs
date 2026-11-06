#!/usr/bin/env node
// Lumi benchmark: runs the current Lumi engine (flows, then the walker) on a fixed set of apps with a fixed step budget
// and prints screens reached, flows finished and planted bugs found, as a table and as JSON.
//   node scripts/lumi/bench.mjs [--budgets 50,200] [--seed 1] [--bugs on|off] [--json] [--out file.json]
//                               [--sim <url> | --start-sim] [--platform android|ios]
// Needs the CLI built: pnpm --filter @shipvo/cli build.
// Spec apps (shop, account) run in-process with planted bugs. `account` is held out: do not tune on it.
// Tide and Tackle runs on a simulator: pass --sim <url> for one that is running, or --start-sim to build and start one.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runApp, runSpecApps, summarize, table } from "./bench-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const budgets = (arg("budgets", "50,200")).split(",").map(Number);
const seed = Number(arg("seed", 1));
const bugs = arg("bugs", "on");
const platform = arg("platform", "android");
if (budgets.some((n) => !Number.isInteger(n) || n < 1) || !Number.isInteger(seed) || seed < 0) { console.error("--budgets must be whole numbers of 1 or more and --seed a whole number of 0 or more"); process.exit(2); }
if (bugs !== "on" && bugs !== "off") { console.error("--bugs must be on or off"); process.exit(2); }
if (platform !== "android" && platform !== "ios") { console.error("--platform must be android or ios"); process.exit(2); }

const cli = (f) => import(resolve(root, "packages/cli/dist", f));
const [explore, flows] = await Promise.all([cli("explore.js"), cli("flows.js")]);
const engine = { walk: explore.walk, runFlows: flows.runFlows };

const rows = await runSpecApps(engine, { budgets, seed, bugsOn: bugs === "on" });

let stop = () => {};
let base = arg("sim");
if (!base && flag("start-sim")) {
  const { loadConfig } = await cli("config.js");
  process.chdir(resolve(root, "apps/tide-and-tackle"));
  const s = await explore.startSim({}, loadConfig());
  base = s.base; stop = s.stop;
}
try {
  if (base) {
    for (const budget of budgets) {
      const r = await runApp(engine, { id: "tide-and-tackle", makeDriver: () => explore.simDriver(base, "tide-and-tackle", `bench-${budget}-${Date.now().toString(36)}`, platform), budget, seed, settleMs: 400, skin: platform });
      rows.push({ ...r, heldOut: false, platform });
    }
  } else console.error("tide-and-tackle skipped: pass --sim <url> or --start-sim to run it on a simulator.");
} finally { stop(); }

const result = { seed, bugs, platform: base ? platform : null, rows, summary: summarize(rows) };
if (arg("out")) writeFileSync(arg("out"), JSON.stringify(result, null, 2) + "\n");
if (flag("json")) console.log(JSON.stringify(result, null, 2));
else { console.log(table(rows)); console.log(); console.log(JSON.stringify(result, null, 2)); }
