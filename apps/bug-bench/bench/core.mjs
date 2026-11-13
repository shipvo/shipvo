// The bug-catch benchmark's scoring and its phone driver. A bug is caught when the same check passes on the fixed app
// and fails on the buggy app, on Shipvo Phone. The driver talks to a running @shipvo/sim over HTTP.

export const PLATFORMS = ["android", "ios"];
export const CLASSES = { logic: "App logic", device: "Device hardware", "native-path": "Android and iOS only code" };

/**
 * caught: the check tells the two apart. missed: it passes on both. invalid: the case is wrong or did not run, because the
 * check fails on the fixed app or either run ended in an error (null) before its check gave an answer.
 */
export function classify(fixedPass, buggyPass) {
  if (fixedPass !== true || buggyPass === null) return "invalid";
  return buggyPass ? "missed" : "caught";
}

/** Counts per class, per platform and in total. `rows` are { id, class, platform, result }. */
export function summarize(rows) {
  const tally = (list) => {
    const caught = list.filter((r) => r.result === "caught").length;
    return { cases: list.length, caught, missed: list.filter((r) => r.result === "missed").length, invalid: list.filter((r) => r.result === "invalid").length, rate: list.length ? Math.round((caught / list.length) * 1000) / 10 : null };
  };
  const by = (key) => Object.fromEntries([...new Set(rows.map((r) => r[key]))].map((k) => [k, tally(rows.filter((r) => r[key] === k))]));
  return { total: tally(rows), byPlatform: by("platform"), byClass: by("class"), missed: rows.filter((r) => r.result === "missed").map((r) => `${r.id} (${r.platform})`), invalid: rows.filter((r) => r.result === "invalid").map((r) => `${r.id} (${r.platform})`) };
}

/** A plain-text table: one line per case with its result on each platform, then the totals. */
export function table(rows) {
  const ids = [...new Set(rows.map((r) => r.id))];
  const cell = (id, p) => rows.find((r) => r.id === id && r.platform === p)?.result ?? "-";
  const lines = [["case", "class", ...PLATFORMS], ...ids.map((id) => [id, rows.find((r) => r.id === id).class, ...PLATFORMS.map((p) => cell(id, p))])];
  const w = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  const s = summarize(rows);
  return [...lines.map((l) => l.map((c, i) => c.padEnd(w[i])).join("  ").trimEnd()), "",
    ...Object.entries(s.byClass).map(([k, v]) => `${CLASSES[k] ?? k}: ${v.caught} of ${v.cases} caught`),
    ...Object.entries(s.byPlatform).map(([k, v]) => `${k}: ${v.caught} of ${v.cases} caught (${v.rate}%)`),
    `Total: ${s.total.caught} of ${s.total.cases} caught (${s.total.rate}%)`].join("\n");
}

/** Finds the ref of the element named `label` in a screen tree. An exact name wins over a name that only contains it. */
export function refOf(tree, label) {
  let partial = null;
  for (const line of String(tree ?? "").split("\n")) {
    const m = /^\s*- \w+ "((?:[^"\\]|\\.)*)"[^\n]*\[ref=(\w+)\]/.exec(line);
    if (!m) continue;
    if (m[1] === label) return m[2];
    if (partial === null && m[1].includes(label)) partial = m[2];
  }
  return partial;
}

/** The text a textbox named `label` holds, or null when there is no such textbox. */
export function valueOf(tree, label) {
  for (const line of String(tree ?? "").split("\n")) {
    const m = /^\s*- textbox "((?:[^"\\]|\\.)*)"[^\n]*\[ref=\w+\](?:: (.*))?$/.exec(line);
    if (m && m[1] === label) return m[2] ?? "";
  }
  return null;
}

/** A phone session on a simulator at `base`. Every method reads the screen the simulator returns. */
export async function openPhone(base, { session, app, platform, fetchImpl = fetch }) {
  const post = async (path, body) => (await fetchImpl(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const opened = await post("/session", { session, app, skin: platform, device: { platform } });
  if (!opened.ok) throw new Error(`could not open ${app}: ${opened.error ?? opened.code}`);
  let tree = opened.screen;
  const act = async (action, body = {}) => { const r = await post("/act", { session, action, ...body }); if (typeof r.screen === "string") tree = r.screen; return r; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const phone = {
    platform,
    screen: async () => { await act("screen"); return tree; },
    /** Taps the element named `label`. Returns false when it is not there, or is disabled, and nothing was sent. */
    tap: async (label) => { const ref = refOf(await phone.screen(), label); if (!ref) return false; return (await act("tap", { ref })).ok === true; },
    type: async (label, text) => { const ref = refOf(await phone.screen(), label); if (!ref) return false; return (await act("type", { ref, text })).ok === true; },
    sees: async (text) => (await phone.screen()).includes(text),
    count: async (text) => (await phone.screen()).split(text).length - 1,
    value: async (label) => valueOf(await phone.screen(), label),
    /** Waits until the screen shows `text`. Resolves false when it never does within `ms`. */
    until: async (text, ms = 3000) => { for (const end = Date.now() + ms; ;) { if (await phone.sees(text)) return true; if (Date.now() >= end) return false; await sleep(120); } },
    wait: sleep,
    setDevice: (device) => act("set_device", { device }),
    end: () => post("/end", { session }).catch(() => {}),
  };
  return phone;
}

/**
 * Runs one case one way (buggy or fixed) on one platform. Resolves true or false, the check's answer, or null when the
 * run broke before the check answered (the phone or the case did not open, or the check threw). null is never a catch.
 */
export async function runVariant(base, c, platform, buggy, { app = "bug-bench", fetchImpl } = {}) {
  const session = `bb-${c.id}-${platform}-${buggy ? "buggy" : "fixed"}`;
  let phone;
  try {
    phone = await openPhone(base, { session, app, platform, fetchImpl });
    if (c.device) await phone.setDevice(c.device);
    if (!(await phone.type("Case", `${c.id}:${buggy ? "buggy" : "fixed"}`)) || !(await phone.tap("Open case"))) throw new Error("the case picker did not open");
    if (!(await phone.until(`"${c.id}"`, 4000))) throw new Error(`case ${c.id} did not open`);
    return (await c.check(phone)) === true;
  } catch (e) {
    if (process.env.BUG_BENCH_DEBUG) console.error(`${session}: ${e.message}`);
    return null;
  } finally { await phone?.end(); }
}

/** Runs every case on every platform it applies to, `parallel` at a time. Resolves the rows in a fixed order. */
export async function runBench(base, cases, { platforms = PLATFORMS, parallel = 4, fetchImpl, onRow } = {}) {
  const jobs = cases.flatMap((c) => platforms.filter((p) => !c.platforms || c.platforms.includes(p)).map((platform) => ({ c, platform })));
  const rows = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
    for (let i = next++; i < jobs.length; i = next++) {
      const { c, platform } = jobs[i];
      const fixedPass = await runVariant(base, c, platform, false, { fetchImpl });
      const buggyPass = await runVariant(base, c, platform, true, { fetchImpl });
      rows[i] = { id: c.id, class: c.class, title: c.title, platform, fixedPass, buggyPass, result: classify(fixedPass, buggyPass) };
      onRow?.(rows[i]);
    }
  }));
  return rows;
}
