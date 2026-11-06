// `shipvo smoke`: does the app load? Starts the simulator (startSim), opens the app, waits for the first screen to settle.
import { existsSync } from "node:fs";
import { args as parse, BOOLEAN_FLAGS, loadConfig } from "./config.js";
import { simDriver, startSim, type Driver, type Skin } from "./explore.js";
import { detectPackageManager, installCommand } from "./ensure-playwright.js";
import { emit, envelope, type Envelope, type Next } from "./json-out.js";

export type SmokeData = { platform?: Skin; time_to_first_screen_ms: number | null; elements: number; errors: string[]; error_count: number };
/** What smoke needs from the environment. Tests replace it. */
export type SmokeDeps = {
  start: () => Promise<{ base: string; stop: () => void }>;
  driver: (base: string, app: string, session: string, platform: Skin) => Driver;
  /** Current accessibility tree. Defaults to the simulator's `screen` action. */
  screen: (base: string, session: string) => Promise<string>;
};

const MAX_ERRORS = 5;
/** Elements in an accessibility tree: lines that carry a ref. */
export const countElements = (tree: string | null | undefined) => (tree ?? "").split("\n").filter((l) => /\[ref=/.test(l)).length;

async function screenOf(base: string, session: string): Promise<string> {
  const r = await fetch(base.replace(/\/$/, "") + "/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session, action: "screen" }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`simulator /act -> ${r.status}`);
  return ((await r.json()) as { screen?: string }).screen ?? "";
}

const installNext = (): Next => { const { cmd, args } = installCommand(detectPackageManager(process.cwd(), existsSync)); return { command: `${cmd} ${args.join(" ")} && npx playwright install chromium`, why: "Install the browser the simulator needs." }; };

/** Words that are not flags or flag values: the platform. */
const positionals = (argv: string[]) => { const out: string[] = []; for (let i = 0; i < argv.length; i++) { const x = argv[i]; if (x.startsWith("--")) { if (!BOOLEAN_FLAGS.has(x.slice(2)) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) i++; } else out.push(x); } return out; };

/** Runs the check and returns the envelope and exit code. Never prints. */
export async function smokeCheck(argv: string[], deps?: Partial<SmokeDeps>): Promise<{ doc: Envelope<string, unknown>; exit: number }> {
  const a = parse(argv);
  const setup = (msg: string, next: Next[] = [{ command: "shipvo doctor --json", why: "Check the setup." }]) => ({ doc: envelope("setup_error", msg, {}, next, 2), exit: 2 });
  const pos = positionals(argv);
  if (pos.length > 1 || (pos[0] !== undefined && pos[0] !== "android" && pos[0] !== "ios")) return setup(`Unknown platform "${pos.join(" ")}". Use android or ios.`, [{ command: "shipvo smoke android", why: "Pick android or ios." }, { command: "shipvo smoke ios", why: "Or the iPhone style." }]);
  const platform: Skin = pos[0] === "ios" ? "ios" : "android";
  const t = a.timeout === undefined ? 30 : Number(a.timeout);
  if (!(t > 0) || !Number.isFinite(t)) return setup("--timeout must be a number of seconds above 0", [{ command: "shipvo smoke --timeout 30", why: "Use a positive number." }]);
  let cfg;
  try { cfg = loadConfig(); } catch (e) { return setup(e instanceof Error ? e.message : String(e), [{ command: "shipvo init .", why: "Set up this folder." }]); }
  const json = argv.includes("--json");
  let sim: { base: string; stop: () => void };
  try { sim = await (deps?.start ?? (() => startSim(a, cfg, json)))(); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const browser = /playwright|chromium|browser|exited before it was ready/i.test(msg);
    return setup(msg, browser ? [installNext(), { command: "shipvo doctor --json", why: "Check the setup." }] : undefined);
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const session = `smoke-${Date.now().toString(36)}`;
    const driver = (deps?.driver ?? simDriver)(sim.base, cfg.appId, session, platform);
    const get = deps?.screen ?? screenOf;
    const started = Date.now();
    const timedOut = new Promise<"timeout">((ok) => { timer = setTimeout(() => ok("timeout"), t * 1000); });
    const run = (async () => {
      const opened = await driver.open();
      if (!opened.ok) throw new Error(opened.error ?? "the simulator could not open the app");
      let tree = opened.screen ?? "";
      // Settled: two snapshots in a row are the same.
      for (let i = 0; i < 20; i++) { const next = await get(sim.base, session); const same = next === tree; tree = next; if (same) break; await new Promise((r) => setTimeout(r, 100)); }
      return { ms: Date.now() - started, tree, errors: await driver.errors() };
    })();
    run.catch(() => {});
    const r = await Promise.race([run, timedOut]);
    if (r === "timeout") {
      const data: SmokeData = { platform, time_to_first_screen_ms: null, elements: 0, errors: [], error_count: 0 };
      return { doc: envelope("timeout", `The app did not show a first screen within ${t} s`, data, [{ command: `shipvo smoke ${platform} --timeout ${Math.ceil(t * 2)} --json`, why: "Try a longer timeout." }], 1), exit: 1 };
    }
    const elements = countElements(r.tree);
    const data: SmokeData = { platform, time_to_first_screen_ms: r.ms, elements, errors: r.errors.slice(0, MAX_ERRORS), error_count: r.errors.length };
    if (r.errors.length) return { doc: envelope("errors", `The app threw ${r.errors.length} error${r.errors.length === 1 ? "" : "s"} while loading: ${r.errors[0]}`, data, [{ command: `shipvo smoke ${platform} --json`, why: "Run again after fixing." }], 1), exit: 1 };
    if (!elements) return { doc: envelope("empty_screen", "The first screen has no elements", data, [{ command: `shipvo smoke ${platform} --json`, why: "Run again after fixing." }], 1), exit: 1 };
    return { doc: envelope("ok", `The app loads on ${platform}: first screen in ${r.ms} ms, ${elements} element${elements === 1 ? "" : "s"}, no errors`, data, [{ command: "shipvo test --json", why: "Run your step files." }], 0), exit: 0 };
  } catch (e) {
    return setup(e instanceof Error ? e.message : String(e));
  } finally { clearTimeout(timer); sim.stop(); }
}

/** Returns the exit code: 0 loads, 1 failed, 2 setup error. */
export async function smoke(argv: string[]): Promise<number> {
  const { doc, exit } = await smokeCheck(argv);
  if (argv.includes("--json")) emit(doc);
  else {
    console.log(doc.summary);
    const d = doc.data as Partial<SmokeData>;
    for (const e of d.errors ?? []) console.log(`  error: ${e}`);
    if ((d.error_count ?? 0) > (d.errors?.length ?? 0)) console.log(`  …and ${d.error_count! - d.errors!.length} more`);
    if (exit) for (const n of doc.next) console.error(`Next: ${n.command}  (${n.why})`);
  }
  return exit;
}
