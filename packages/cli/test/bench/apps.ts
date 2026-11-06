// Benchmark apps for the action ranker: generated fake apps behind the walker's Driver interface.
// Each app has a hidden screen graph. A button's label hints at what it does, but only most of the time,
// and each app shifts the odds, so a ranker has to learn a tendency and cannot memorise an app.
// Apps are seeded: benchApp(seed) is fully determined by its seed. The benchmark trains on one seed range and
// evaluates on another (see benchmark() below). Re-run the table with SHOW_BENCH=1 pnpm --filter @shipvo/cli test -- explore-ranker.
import { walk, type Driver, type Reply } from "../../src/explore.js";
import { train, type Ranker, type Sample } from "../../src/explore-ranker.js";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Labels by what they usually do, and the chance that such a button opens a screen. */
const POOL: { labels: string[]; open: number }[] = [
  { labels: ["Continue", "Next", "Save", "Submit", "Start", "Checkout"], open: 0.7 },
  { labels: ["View details", "Open", "See more", "Browse", "Read more"], open: 0.75 },
  { labels: ["Settings", "Profile", "Orders", "Cart", "History", "Help", "Inbox"], open: 0.8 },
  { labels: ["Add item", "New note", "Create"], open: 0.6 },
  { labels: ["Filter", "Sort", "Like", "Mute", "Select all"], open: 0.15 },
  { labels: ["Close", "Skip", "Not now", "Dismiss"], open: 0.05 },
  { labels: ["Pineapple", "Zebra", "Quokka", "Mango", "Lantern"], open: 0.4 },
];
const BUGS = ["- text: Network request failed", "- progressbar [ref=eX]", ""] as const;

export type BenchApp = { name: string; make(): Driver; screens: number; bugs: number };

/** One generated app. */
export function benchApp(seed: number): BenchApp {
  const r = rng(seed * 7919 + 13);
  const n = 18 + Math.floor(r() * 14); // 18 to 31 screens
  type Btn = { label: string; to: number | null };
  const screens: { btns: Btn[]; bug: number }[] = [];
  const tilt = POOL.map(() => (r() - 0.5) * 0.3); // each app shifts the odds a little
  const pickBtn = (): { label: string; p: number } => {
    const g = Math.floor(r() * POOL.length); const grp = POOL[g]!;
    return { label: grp.labels[Math.floor(r() * grp.labels.length)]!, p: Math.min(0.95, Math.max(0.02, grp.open + tilt[g]!)) };
  };
  for (let i = 0; i < n; i++) screens.push({ btns: [], bug: -1 });
  // A spanning tree first, so every screen can be reached, then buttons that do not open anything new.
  const opener: Btn[][] = screens.map(() => []);
  for (let i = 1; i < n; i++) {
    const from = Math.floor(r() * i);
    // The parent needs a button that opens screen i; choose a label whose odds are high, as an author would.
    const g = Math.floor(r() * 4); const grp = POOL[g]!;
    opener[from]!.push({ label: grp.labels[Math.floor(r() * grp.labels.length)]!, to: i });
  }
  for (let i = 0; i < n; i++) {
    const s = screens[i]!; const seen = new Set<string>();
    const add = (b: Btn) => { if (!seen.has(b.label)) { seen.add(b.label); s.btns.push(b); } };
    opener[i]!.forEach(add);
    const extra = 2 + Math.floor(r() * 3);
    for (let k = 0; k < extra; k++) {
      const { label, p } = pickBtn();
      add({ label, to: r() < p ? Math.floor(r() * n) : null }); // may land on an already known screen
    }
    // Shuffle so position says nothing about what a button does.
    for (let k = s.btns.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [s.btns[k], s.btns[j]] = [s.btns[j]!, s.btns[k]!]; }
    if (i > 0 && r() < 0.14) s.bug = Math.floor(r() * BUGS.length);
  }
  const render = (id: number) => {
    const s = screens[id]!; const lines = [`- heading "Screen ${id}" [ref=e1]`];
    const bug = s.bug >= 0 ? BUGS[s.bug]!.replace("eX", "e99") : "";
    if (bug) lines.push(bug);
    s.btns.forEach((b, k) => lines.push(`- button "${b.label}" [ref=b${k}]`));
    if (id > 0) lines.push(`- button "Back" [ref=bk]`);
    return lines.join("\n");
  };
  return {
    name: `bench-${seed}`, screens: n, bugs: screens.filter((s) => s.bug >= 0).length,
    make() {
      let at = 0; const stack: number[] = [];
      const view = (): Reply => ({ ok: true, screen: render(at) });
      return {
        async open() { at = 0; stack.length = 0; return view(); },
        async openUrl() { return view(); },
        async tap(ref) {
          if (ref === "bk") { at = stack.pop() ?? 0; return { ...view(), delivery: "delivered" }; }
          const to = screens[at]!.btns[Number(ref.slice(1))]?.to;
          if (to != null && to !== at) { stack.push(at); at = to; }
          return { ...view(), delivery: "delivered" };
        },
        async back() { if (!stack.length) return { ok: false, error: "no Back button", screen: render(at) }; at = stack.pop()!; return view(); },
        async errors() { return []; },
        async snapshot() { return view(); },
      };
    },
  };
}

export type Score = { screens: number; findings: number };
const settle = { settleMs: 1, maxDepth: 5 };

/** Run the heuristic walker, or a ranker-guided one, on an app. Returns what it reached and the samples it recorded. */
export async function run(app: BenchApp, steps: number, seed: number, ranker?: Ranker): Promise<Score & { samples: Sample[] }> {
  const samples: Sample[] = [];
  const r = await walk(app.make(), { ...settle, maxSteps: steps, seed, ranker, onSample: (s) => samples.push(s) });
  return { screens: r.screens, findings: r.findings.length, samples };
}

export const TRAIN_APPS = Array.from({ length: 30 }, (_, i) => i + 1);
export const EVAL_APPS = Array.from({ length: 40 }, (_, i) => i + 1001);
export const WALK_SEEDS = [1, 2, 3];

/** Train on the training apps (heuristic walks at several budgets), then measure both walkers on apps never seen in training. */
export async function benchmark(budgets: number[]) {
  const samples: Sample[] = [];
  for (const id of TRAIN_APPS) for (const seed of WALK_SEEDS) samples.push(...(await run(benchApp(id), 40, seed + 100)).samples);
  const ranker = train(samples);
  const rows = [];
  for (const steps of budgets) {
    const sum = { h: { screens: 0, findings: 0 }, m: { screens: 0, findings: 0 } }; let runs = 0;
    for (const id of EVAL_APPS) for (const seed of WALK_SEEDS) {
      const h = await run(benchApp(id), steps, seed), m = await run(benchApp(id), steps, seed, ranker);
      sum.h.screens += h.screens; sum.h.findings += h.findings; sum.m.screens += m.screens; sum.m.findings += m.findings; runs++;
    }
    rows.push({ steps, runs, heuristic: { screens: sum.h.screens / runs, findings: sum.h.findings / runs }, ranker: { screens: sum.m.screens / runs, findings: sum.m.findings / runs } });
  }
  return { ranker, trainSamples: samples.length, rows };
}
