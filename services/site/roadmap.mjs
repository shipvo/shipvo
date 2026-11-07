// Parses docs/ROADMAP.md (the single source) into data for the /roadmap/ page, and renders the page body.
// Pure functions except fetchProgress, which takes an injectable fetch so tests never hit the network.
import { marked } from "marked";

const ISSUES = "https://github.com/shipvo/shipvo/issues/";
const PULLS = "https://github.com/shipvo/shipvo/pull/";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const section = (md, name) => {
  const m = md.match(new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
  return m ? m[1].trim() : "";
};

export function parseRoadmap(md) {
  const goal = section(md, "Goal").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const now = [];
  let group = null;
  for (const line of section(md, "Now").split("\n")) {
    const g = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (g) { group = { title: g[1].replace(/:$/, ""), items: [] }; now.push(group); continue; }
    const li = line.match(/^- (.+)$/);
    if (li && group) {
      let text = li[1];
      const ref = text.match(/\s*\(#(\d+)\)\s*$/);
      if (ref) text = text.slice(0, ref.index);
      group.items.push({ text, issue: ref ? Number(ref[1]) : null });
    }
  }
  const shipped = [...section(md, "Shipped").matchAll(/^- (\d{4}-\d{2}-\d{2}): (.+)$/gm)].map((m) => {
    let text = m[2];
    const tail = text.match(/\s*\(((?:\[[^\]]+\]\([^)]+\))?(?:,?\s*#\d+)*)\)\s*$/);
    let doc = null, prs = [];
    if (tail) {
      text = text.slice(0, tail.index);
      const d = tail[1].match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (d) doc = { label: d[1], href: d[2] };
      prs = [...tail[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1]));
    }
    return { date: m[1], text, doc, prs };
  }).sort((a, b) => b.date.localeCompare(a.date));   // stable: file order is kept within a day
  const notDoing = [...(section(md, "Promises") || section(md, "Not doing \\(for now\\)")).matchAll(/^- (.+)$/gm)].map((m) => m[1]);
  return { goal, now, shipped, notDoing };
}

// Counts task-list boxes in an issue body. Returns null when there is no task list.
export function countTasks(body) {
  const boxes = [...String(body || "").matchAll(/^\s*[-*] \[( |x|X)\]/gm)];
  if (!boxes.length) return null;
  return { done: boxes.filter((b) => b[1] !== " ").length, total: boxes.length };
}

// Live slice progress from each epic's task list. Any failure leaves that epic without a bar.
export async function fetchProgress(numbers, { fetchFn = fetch, token = "" } = {}) {
  const out = {};
  await Promise.all([...new Set(numbers)].map(async (n) => {
    try {
      const r = await fetchFn(`https://api.github.com/repos/shipvo/shipvo/issues/${n}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "shipvo-site-build", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return;
      const p = countTasks((await r.json()).body);
      if (p) out[n] = p;
    } catch { /* offline build: just the link */ }
  }));
  return out;
}

const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const cleanGroup = (t) => t.replace(/\s*\((?:owner direction|from)[^)]*\)\s*/i, "").replace(/:$/, "").trim();
// "Lumi Autotest: `npx shipvo lumi` builds..." → title "Lumi Autotest", rest "`npx shipvo lumi` builds..."
export function splitItem(text) {
  const i = text.indexOf(": ");
  if (i > 0 && i <= 60 && (text.slice(0, i).split("`").length - 1) % 2 === 0) { const r = text.slice(i + 2); return { title: text.slice(0, i), rest: /^[a-z]/.test(r) ? r[0].toUpperCase() + r.slice(1) : r }; }
  return { title: text, rest: "" };
}
const dayKey = (d) => d;
const daysBetween = (a, b) => Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 864e5);

export function renderRoadmap(data, { resolveHref = (h) => h, progress = {}, today = null } = {}) {
  const renderer = new marked.Renderer();
  renderer.link = function ({ href, tokens }) {
    const h = resolveHref(href);
    return `<a href="${esc(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
  };
  const inline = (s) => marked.parseInline(s, { renderer, gfm: true });
  const lede = data.goal[1] ?? data.goal[0] ?? "";
  const items = data.now.flatMap((g) => g.items);
  const newest = data.shipped[0]?.date;
  const ref = today ?? newest;
  const recent = data.shipped.filter((s) => ref && daysBetween(ref, s.date) < 7);
  const latest = data.shipped.filter((s) => s.date === newest);
  const first = data.shipped.at(-1)?.date;

  const card = (it) => {
    const pr = it.issue && progress[it.issue];
    const { title, rest } = splitItem(it.text);
    const bar = pr ? `<div class="rm-progwrap"><div class="rm-prog" role="img" aria-label="${pr.done} of ${pr.total} slices done"><span style="width:${Math.round((pr.done / pr.total) * 100)}%"></span></div><span class="rm-count">${pr.done} of ${pr.total} slices done</span></div>` : "";
    const link = it.issue ? `<a class="rm-issue" href="${ISSUES}${it.issue}" rel="noopener">#${it.issue}<span class="rm-sr"> on GitHub</span></a>` : "";
    return `<li class="rm-card"><div><h4>${inline(title)}</h4>${rest ? `<p>${inline(rest)}</p>` : ""}</div><div class="rm-meta">${bar}${link}</div></li>`;
  };
  const now = data.now.map((g, gi) => `<div class="rm-track"><div class="rm-thead"><span class="rm-tnum">${String(gi + 1).padStart(2, "0")}</span><h3>${inline(cleanGroup(g.title))}</h3><span class="rm-tcount">${g.items.length} in progress</span></div><ul class="rm-cards">${g.items.map(card).join("")}</ul></div>`).join("");

  const shipRow = (s) => `<li class="rm-ship"><time datetime="${s.date}">${fmtDate(s.date)}</time><div><p>${inline(s.text)}</p><p class="rm-refs">${s.doc ? `<a class="rm-doc" href="${esc(resolveHref(s.doc.href))}">${esc(s.doc.label)} <span aria-hidden="true">→</span></a>` : ""}${s.prs.map((n) => `<a class="rm-pr" href="${PULLS}${n}" rel="noopener">#${n}</a>`).join("")}</p></div></li>`;
  const byDay = new Map();
  for (const s of data.shipped) { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); }
  const dayName = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const days = [...byDay.entries()];
  const dayBlock = ([d, list], open) => `<details class="rm-day"${open ? " open" : ""}><summary><span>${dayName(d)}</span><b>${list.length} shipped</b></summary><ol class="rm-list">${list.map(shipRow).join("")}</ol></details>`;
  const shippedHtml = days.map((e, k) => dayBlock(e, k === 0)).join("");
  const not = data.notDoing.map((t) => `<li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><p>${inline(t)}</p></li>`).join("");

  return `<div class="wrap rm" id="rm-main">
<header class="rm-hero"><div class="eyebrow">Roadmap</div><h1>Where Shipvo is going.</h1><p class="lede">${inline(lede)}</p>
<dl class="rm-stats"><div><dt>In progress</dt><dd>${items.length}</dd><span>across ${data.now.length} tracks</span></div><div><dt>Shipped latest</dt><dd>${latest.length}</dd><span>${newest ? fmtDate(newest) : ""}</span></div><div><dt>Shipped in total</dt><dd>${data.shipped.length}</dd>${first ? `<span>since ${fmtDate(first)}</span>` : ""}</div></dl>
<div class="fsearch rm-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" placeholder="Search the roadmap" aria-label="Search the roadmap" data-filter="#rm-main" data-items=".rm-card, .rm-ship" data-groups=".rm-track, .rm-day" data-count="#rm-count"><kbd aria-hidden="true">/</kbd><span id="rm-count" class="fcount" aria-live="polite"></span></div>
<nav class="rm-jump" aria-label="Roadmap sections"><a href="#now">In progress</a><a href="#shipped">Shipped</a><a href="#not-doing">Our promises</a></nav></header>
<section id="now" class="rm-sec"><div class="rm-shead"><h2>In progress</h2><p class="rm-sub">What the team is building now, grouped into tracks. Each card links to its epic on GitHub.</p></div>${now}</section>
<section id="shipped" class="rm-sec"><div class="rm-shead"><h2>Shipped</h2><p class="rm-sub">Newest day first. Every line links to its guide and pull requests; the <a href="/changelog/">changelog</a> lists every change.</p></div>${shippedHtml}</section>
<section id="not-doing" class="rm-sec"><div class="rm-shead"><h2>Our promises</h2><p class="rm-sub">Lines we hold, whatever else changes.</p></div><ul class="rm-not">${not}</ul></section>
<p data-filter-empty hidden class="fempty">Nothing on the roadmap matches that search.</p>
<p class="rm-foot">Built from <a href="https://github.com/shipvo/shipvo/blob/main/docs/ROADMAP.md" rel="noopener"><code>docs/ROADMAP.md</code></a>; every change to it is a pull request. See also the <a href="/changelog/">changelog</a>.</p>
</div>`;
}
