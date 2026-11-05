// Search and filters for Learn. Pure functions with no DOM, so the browser and the tests share them.
export const TYPES = [["tutorial", "Tutorial"], ["video", "Video"], ["glossary", "Glossary"]];
export const GOALS = [["start", "Start"], ["sell", "Sell"], ["run-your-app", "Run your app"], ["test", "Test"], ["ship-updates", "Ship updates"]];
export const LEVELS = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]];
export const TIMES = [["under-10", "Under 10 min"], ["10-30", "10 to 30 min"], ["over-30", "Over 30 min"]];
export const FACETS = { type: TYPES, goal: GOALS, level: LEVELS, time: TIMES };

const WORDS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, few: 5 };
// "1 min 39 s" -> 1.65, "about two minutes" -> 2, "a few minutes" -> 5, "45 minutes" -> 45. Unknown -> null.
export function parseMinutes(text) {
  const s = String(text || "").toLowerCase();
  const m = s.match(/(\d+|a few|[a-z]+)\s*(?:to\s*\d+\s*)?(hours?|hrs?|minutes?|mins?)\b(?:\s*(\d+)\s*s\b)?/);
  if (!m) return null;
  let n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].replace("a ", "")];
  if (n === undefined) return null;
  if (/^h/.test(m[2])) n *= 60;
  return n + (m[3] ? Number(m[3]) / 60 : 0);
}
export const timeBucket = (min) => (min == null ? "" : min < 10 ? "under-10" : min <= 30 ? "10-30" : "over-30");

const norm = (s) => String(s || "").toLowerCase();
const tokens = (q) => norm(q).split(/[^a-z0-9]+/).filter(Boolean);

// Every word of the query must appear somewhere. Title hits count most, then headings and description, then the body.
export function score(entry, toks) {
  if (!toks.length) return 1;
  const title = norm(entry.title), mid = norm(entry.desc + " " + (entry.headings || []).join(" ")), body = norm(entry.text);
  let total = 0;
  for (const t of toks) {
    const s = (title.includes(t) ? 10 : 0) + (mid.includes(t) ? 4 : 0) + (body.includes(t) ? 1 : 0);
    if (!s) return 0;
    total += s;
  }
  return total;
}

const matches = (e, state, skip) =>
  (skip === "type" || !state.type || e.type === state.type) &&
  (skip === "goal" || !state.goal || e.goal === state.goal) &&
  (skip === "level" || !state.level || e.level === state.level) &&
  (skip === "time" || !state.time || timeBucket(e.minutes) === state.time);

export function searchIndex(index, state) {
  const toks = tokens(state.q);
  return index.map((e) => ({ e, s: matches(e, state) ? score(e, toks) : 0 })).filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.e.order - b.e.order).map((r) => r.e);
}

// How many results each option of one filter would give, with the search and the other filters applied.
export function facetCounts(index, state, key) {
  const toks = tokens(state.q), out = {};
  for (const [v] of FACETS[key]) out[v] = 0;
  for (const e of index) {
    if (!matches(e, state, key) || !score(e, toks)) continue;
    const v = key === "type" ? e.type : key === "goal" ? e.goal : key === "level" ? e.level : timeBucket(e.minutes);
    if (v in out) out[v]++;
  }
  return out;
}

export function parseState(search) {
  const p = new URLSearchParams(search), st = { q: (p.get("q") || "").trim() };
  for (const k of Object.keys(FACETS)) { const v = p.get(k) || ""; st[k] = FACETS[k].some(([x]) => x === v) ? v : ""; }
  return st;
}
export function toQuery(state) {
  const p = new URLSearchParams();
  if (state.q && state.q.trim()) p.set("q", state.q.trim());
  for (const k of Object.keys(FACETS)) if (state[k]) p.set(k, state[k]);
  const s = p.toString();
  return s ? "?" + s : "";
}
export const isActive = (state) => !!(state.q && state.q.trim()) || Object.keys(FACETS).some((k) => state[k]);
