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
  const notDoing = [...section(md, "Not doing \\(for now\\)").matchAll(/^- (.+)$/gm)].map((m) => m[1]);
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

export function renderRoadmap(data, { resolveHref = (h) => h, progress = {} } = {}) {
  const renderer = new marked.Renderer();
  renderer.link = function ({ href, tokens }) {
    const h = resolveHref(href);
    return `<a href="${esc(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
  };
  const inline = (s) => marked.parseInline(s, { renderer, gfm: true });
  const goal = data.goal.map((p, i) => `<p${i === 0 ? ' class="lede"' : ""}>${inline(p)}</p>`).join("");
  const now = data.now.map((g) => `<div class="rm-group"><h3 class="rm-gtitle">${inline(g.title)}</h3><ul class="rm-cards">${g.items.map((it) => {
    const pr = it.issue && progress[it.issue];
    const bar = pr ? `<div class="rm-prog" role="img" aria-label="${pr.done} of ${pr.total} slices done"><span style="width:${Math.round((pr.done / pr.total) * 100)}%"></span></div><span class="rm-count">${pr.done} of ${pr.total} slices done</span>` : "";
    const link = it.issue ? `<a class="rm-issue" href="${ISSUES}${it.issue}" rel="noopener">#${it.issue}<span class="rm-sr"> on GitHub</span></a>` : "";
    return `<li class="rm-card"><p>${inline(it.text)}</p><div class="rm-meta">${link}${bar}</div></li>`;
  }).join("")}</ul></div>`).join("");
  const shipped = data.shipped.map((s) => `<li class="rm-ship"><time datetime="${s.date}">${fmtDate(s.date)}</time><div><p>${inline(s.text)}</p><p class="rm-refs">${s.doc ? `<a class="rm-doc" href="${esc(resolveHref(s.doc.href))}">${esc(s.doc.label)}</a>` : ""}${s.prs.map((n) => `<a class="rm-pr" href="${PULLS}${n}" rel="noopener">#${n}</a>`).join("")}</p></div></li>`).join("");
  const not = data.notDoing.map((t) => `<li>${inline(t)}</li>`).join("");
  return `<div class="wrap rm">
<header class="rm-hero"><div class="eyebrow">Roadmap</div><h1>Where Shipvo is going.</h1>${goal}<nav class="rm-jump" aria-label="Roadmap sections"><a href="#now">Now</a><a href="#shipped">Shipped</a><a href="#not-doing">Not doing</a></nav></header>
<section id="now" class="rm-sec"><h2>Now</h2><p class="rm-sub">Epics in flight. Each links to its GitHub issue.</p>${now}</section>
<section id="shipped" class="rm-sec"><h2>Shipped</h2><p class="rm-sub">Newest first. Dates are merge dates.</p><ol class="rm-list">${shipped}</ol></section>
<section id="not-doing" class="rm-sec"><h2>Not doing (for now)</h2><ul class="rm-not">${not}</ul></section>
<p class="rm-foot">This page is built from <a href="https://github.com/shipvo/shipvo/blob/main/docs/ROADMAP.md" rel="noopener"><code>docs/ROADMAP.md</code></a>. Every change is a normal pull request. See also the <a href="/changelog/">changelog</a>.</p>
</div>`;
}
