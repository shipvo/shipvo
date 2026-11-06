// `shipvo smoke [android|ios]`: does the app load in the simulator? One answer for an agent that just changed the app.
import { existsSync } from "node:fs";
import { args as parse, loadConfig } from "./config.js";
import { detectPackageManager, installCommand } from "./ensure-playwright.js";
import { simDriver, startSim, signature, type Driver } from "./explore.js";

type Next = { command: string; why: string };
export type SmokeJson = {
  ok: boolean;
  code: "ok" | "load_failed" | "setup_error";
  summary: string;
  data: { platform: string; time_to_first_screen_ms: number | null; elements: number; errors: string[]; error_count: number };
  next: Next[];
};
export type SmokeDeps = {
  start?: (a: Record<string, string | undefined>, cfg: { name: string; appId: string; controlPlane: string }) => Promise<{ base: string; stop: () => void }>;
  driver?: (base: string, app: string) => Driver;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

/** Elements in a tree: every line that carries a ref. */
export const countElements = (tree: string) => (tree.match(/\[ref=\w+\]/g) ?? []).length;
const MAX_SHOWN = 5;

export async function smoke(argv: string[], deps: SmokeDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const json = argv.includes("--json");
  const a = parse(argv);
  const positional = argv.filter((x, i) => !x.startsWith("--") && !(argv[i - 1]?.startsWith("--") && !["--json", "--skip-build"].includes(argv[i - 1]!)));
  const platform = positional[0] ?? "android";
  const done = (doc: SmokeJson, exit: number) => {
    if (json) log(JSON.stringify(doc));
    else {
      log(`${doc.ok ? "PASS" : "FAIL"} ${doc.summary}`);
      log(`platform: ${doc.data.platform}`);
      if (doc.data.time_to_first_screen_ms !== null) log(`first screen: ${(doc.data.time_to_first_screen_ms / 1000).toFixed(1)} s`);
      log(`elements: ${doc.data.elements}`);
      for (const e of doc.data.errors) log(`error: ${e}`);
      if (doc.data.error_count > doc.data.errors.length) log(`…and ${doc.data.error_count - doc.data.errors.length} more`);
      for (const n of doc.next) log(`next: ${n.command}  (${n.why})`);
    }
    return exit;
  };
  const empty = { platform, time_to_first_screen_ms: null, elements: 0, errors: [] as string[], error_count: 0 };
  const setup = (msg: string, next: Next[]) => done({ ok: false, code: "setup_error", summary: msg, data: { ...empty, errors: [msg], error_count: 1 }, next }, 2);

  if (platform !== "android" && platform !== "ios") return setup(`Unknown platform "${platform}". Use android or ios.`, [{ command: "shipvo smoke android", why: "Pick android or ios." }]);
  const timeoutS = a.timeout === undefined ? 30 : Number(a.timeout);
  if (!(timeoutS > 0)) return setup("--timeout must be a number of seconds above 0.", [{ command: "shipvo smoke --timeout 30", why: "Give the seconds to wait." }]);

  let cfg; let sim: { base: string; stop: () => void };
  try {
    cfg = loadConfig();
    sim = await (deps.start ?? startSim)(a, cfg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const next: Next[] = [];
    if (/playwright|simulator exited/i.test(msg)) {
      const { cmd, args } = installCommand(detectPackageManager(process.cwd(), existsSync));
      next.push({ command: /simulator exited/i.test(msg) ? "npx playwright install chromium" : [cmd, ...args].join(" "), why: "The simulator needs Playwright and a browser." });
    }
    next.push({ command: "shipvo doctor", why: "Check the setup." });
    return setup(msg, next);
  }

  try {
    const driver = (deps.driver ?? simDriver)(sim.base, cfg.appId);
    const t0 = now(); const deadline = t0 + timeoutS * 1000;
    const errors: string[] = [];
    const collect = async () => {
      for (const e of await driver.errors()) errors.push(`Uncaught error: ${e}`);
      for (const e of (await driver.consoleErrors?.()) ?? []) errors.push(`console.error: ${e}`);
    };
    let tree = ""; let ms: number | null = null; let timedOut = false;
    try {
      const open = await Promise.race([driver.open(), sleep(timeoutS * 1000).then(() => null)]);
      if (!open) timedOut = true;
      else if (!open.ok) errors.push(`The app did not open: ${open.error ?? "unknown error"}`);
      else {
        tree = open.screen ?? "";
        ms = now() - t0;
        // Settled = the same tree twice in a row.
        for (let prev = ""; now() < deadline; ) {
          await collect();
          prev = tree; tree = driver.screen ? await driver.screen() : tree;
          if (signature(tree) === signature(prev)) break;
          await sleep(300);
          ms = now() - t0;
        }
        await collect();
      }
    } catch (e) {
      errors.push(`The simulator failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (timedOut) errors.push(`The app did not open within ${timeoutS} s.`);
    const elements = countElements(tree);
    if (!timedOut && ms !== null && elements === 0) errors.push("The first screen has no elements in the tree.");
    const uniq = [...new Set(errors)];
    const ok = uniq.length === 0;
    const data = { platform, time_to_first_screen_ms: ms, elements, errors: uniq.slice(0, MAX_SHOWN), error_count: uniq.length };
    const next: Next[] = ok ? [{ command: "shipvo explore", why: "Walk every screen for deeper problems." }]
      : [{ command: "shipvo sim", why: "Open the app yourself and read the console." }, { command: "shipvo smoke " + platform, why: "Run again after the fix." }];
    return done({ ok, code: ok ? "ok" : "load_failed", summary: ok ? `The app loads on ${platform}: ${elements} elements.` : `The app does not load cleanly on ${platform}: ${uniq.length} problem${uniq.length === 1 ? "" : "s"}.`, data, next }, ok ? 0 : 1);
  } finally { sim.stop(); }
}
