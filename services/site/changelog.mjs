// Changelog page: CHANGELOG.md (released) + changes/*.md (on main) + the roadmap's Shipped lines (the highlights).
// One entry per date, newest first: the day's highlights in plain words, the packages released, and every change
// grouped by area behind "All changes". Pure functions; build.mjs does the file I/O.
import { marked } from "marked";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inline = (s, renderer) => marked.parseInline(s, { gfm: true, ...(renderer ? { renderer } : {}) });
const DATE = /^(\d{4}-\d{2}-\d{2})/;

// Area labels for the first word of a change line ("cli: ...", "`@shipvo/mcp`: ...").
const AREAS = [
  [/^(lumi)$/, "Lumi"], [/^(run|phone)$/, "Shipvo Phone"], [/^(sim|simulator)$/, "Simulator"], [/^(mcp|mcp-tools|vault)$/, "MCP"],
  [/^(cli|init|doctor|create-shipvo|shipvo|agents|agents setup|eas|ci|store)$/, "CLI"], [/^(runtime|ota)$/, "OTA runtime"],
  [/^(device)$/, "Device API"], [/^(test|explore)$/, "Testing"], [/^(spec|apps|app engine)$/, "App engine"],
  [/^(control-plane|admin|orders)$/, "Control plane"], [/^(capacitor|capacitor-sample)$/, "Capacitor"], [/^(chess)$/, "Demos"],
  [/^(schema)$/, "Schema"], [/^(site|docs|blog|tutorial|video|readme)$/, "Docs and site"], [/^(first-run|scripts|e2e|device-lab)$/, "CI and measurements"],
];
export function areaOf(line) {
  const m = line.match(/^(?:\*\*)?`?(?:@shipvo\/)?([a-z][a-z0-9-]*(?: setup| engine)?)`?(?:\*\*)?(?: and [a-z-]+)?:\s+([\s\S]+)$/i);
  if (!m) return { area: "More", text: line };
  const key = m[1].toLowerCase();
  const hit = AREAS.find(([re]) => re.test(key));
  return hit ? { area: hit[1], text: m[2] } : { area: "More", text: line };
}

// CHANGELOG.md → [{ date, label, packages: [{name, version}], changes: [text] }], one per date, newest first.
export function parseChangelog(md) {
  const out = [];
  let cur = null;
  for (const raw of md.split("\n")) {
    const h = raw.match(/^## (.+?)\s*$/);
    if (h) {
      const date = h[1].match(DATE)?.[1] ?? null;
      if (!date && cur) continue;                          // a stray "Unreleased" heading joins the release above it
      const label = date ? (/and earlier/.test(h[1]) ? "and earlier" : "") : h[1];
      cur = out.find((e) => e.date === date && date) ?? null;
      if (!cur) { cur = { date, label, packages: [], changes: [] }; out.push(cur); }
      continue;
    }
    if (!cur) continue;
    const li = raw.match(/^- (.+)$/);
    if (!li) continue;
    const pkg = li[1].match(/^\*\*((?:@shipvo\/)?[\w-]+) (\d+\.\d+\.\d+)\*\*/);
    if (pkg) { if (!cur.packages.some((p) => p.name === pkg[1])) cur.packages.push({ name: pkg[1], version: pkg[2] }); continue; }
    if (/^Migration: none/i.test(li[1])) continue;
    cur.changes.push(li[1]);
  }
  return out.filter((e) => e.packages.length || e.changes.length).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function groupByArea(lines) {
  const groups = new Map();
  for (const l of lines) { const { area, text } = areaOf(l); if (!groups.has(area)) groups.set(area, []); groups.get(area).push(text); }
  const order = [...AREAS.map((a) => a[1]), "More"];
  return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

const fmt = (d, opts) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function changesBlock(lines, renderer, open = false) {
  if (!lines.length) return "";
  const groups = groupByArea(lines);
  return `<details class="cl-all"${open ? " open" : ""}><summary><span>All changes</span><b>${lines.length}</b><span class="cl-areas">${groups.map(([a, l]) => `<i>${esc(a)} ${l.length}</i>`).join("")}</span></summary>
<div class="cl-groups">${groups.map(([a, l]) => `<div class="cl-group"><h4>${esc(a)}</h4><ul>${l.map((t) => `<li data-area="${esc(a)}">${inline(t, renderer)}</li>`).join("")}</ul></div>`).join("")}</div></details>`;
}

// highlights: roadmap Shipped items ({date, text, doc, prs}); pending: change lines from changes/*.md
export function renderChangelog({ releases, pending = [], highlights = [], resolveHref = (h) => h }) {
  const renderer = new marked.Renderer();
  renderer.link = function ({ href, tokens }) { const h = resolveHref(href); return `<a href="${esc(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`; };
  const hl = (date) => highlights.filter((h) => h.date === date);
  const hlItem = (h) => `<li><p>${inline(h.text, renderer)}</p>${h.doc ? `<a class="cl-more" href="${esc(resolveHref(h.doc.href))}">${esc(h.doc.label)} <span aria-hidden="true">→</span></a>` : ""}</li>`;
  const SHOW = 4;
  const hlList = (items) => !items.length ? "" : `<ul class="cl-hl">${items.slice(0, SHOW).map(hlItem).join("")}</ul>${items.length > SHOW ? `<details class="cl-hlmore"><summary>${items.length - SHOW} more highlight${items.length - SHOW === 1 ? "" : "s"}</summary><ul class="cl-hl">${items.slice(SHOW).map(hlItem).join("")}</ul></details>` : ""}`;
  const months = [...new Set(releases.filter((r) => r.date).map((r) => r.date.slice(0, 7)))];
  const total = releases.reduce((n, r) => n + r.changes.length, 0) + pending.length;
  const firstDate = releases.filter((r) => r.date).at(-1)?.date;

  const next = pending.length ? `<li class="cl-entry cl-next" id="next"><div class="cl-when"><span class="cl-dot live" aria-hidden="true"></span><span class="cl-tag">On main</span></div>
<div class="cl-body"><h2>Coming in the next release</h2><p class="cl-sum">Merged and live on the hosted services. The packages reach npm with the next release.</p>${changesBlock(pending, renderer)}</div></li>` : "";

  const entries = releases.map((r) => {
    const id = r.date ?? "earlier";
    const items = r.date ? hl(r.date) : [];
    const title = r.date ? fmt(r.date, { day: "numeric", month: "long", year: "numeric" }) + (r.label ? ` ${esc(r.label)}` : "") : esc(r.label);
    const pk = r.packages.length ? `<details class="cl-pkgbox"><summary><span>On npm</span><b>${plural(r.packages.length, "package")}</b><span class="cl-areas">${r.packages.slice(0, 3).map((p) => `<i>${esc(p.name.replace("@shipvo/", ""))} ${esc(p.version)}</i>`).join("")}${r.packages.length > 3 ? `<i>+${r.packages.length - 3}</i>` : ""}</span></summary><div class="cl-pkgs">${r.packages.map((p) => `<a href="https://www.npmjs.com/package/${esc(p.name)}/v/${esc(p.version)}" rel="noopener"><span>${esc(p.name)}</span><b>${esc(p.version)}</b></a>`).join("")}</div></details>` : "";
    return `<li class="cl-entry" id="${esc(id)}"><div class="cl-when"><span class="cl-dot" aria-hidden="true"></span>${r.date ? `<time datetime="${r.date}">${fmt(r.date, { weekday: "short" })}</time>` : ""}${r.packages.length ? `<span class="cl-tag">Release</span>` : ""}</div>
<div class="cl-body"><h2><a href="#${esc(id)}">${title}</a></h2>${items.length ? "" : `<p class="cl-sum">${plural(r.changes.length, "change")}${r.packages.length ? `, ${plural(r.packages.length, "package")} released` : ""}.</p>`}${hlList(items)}${pk}${changesBlock(r.changes, renderer)}</div></li>`;
  }).join("");

  return `<div class="wrap cl"><aside class="cl-side"><div class="eyebrow">Changelog</div><h1>What shipped.</h1>
<p>Every Shipvo release, newest first: the highlights in plain words, the packages on npm, and every change behind <b>All changes</b>.</p>
<div class="fsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" placeholder="Search the changelog" aria-label="Search the changelog" data-filter="#cl-feed" data-items=".cl-hl li, .cl-groups li" data-groups=".cl-entry, .cl-group, .cl-hlmore" data-count="#cl-count"><kbd aria-hidden="true">/</kbd><span id="cl-count" class="fcount" aria-live="polite"></span></div>
<dl class="cl-stats"><div><dt>Changes</dt><dd>${total}</dd></div><div><dt>Releases</dt><dd>${releases.filter((r) => r.packages.length).length}</dd></div>${firstDate ? `<div><dt>Since</dt><dd>${fmt(firstDate, { day: "numeric", month: "short" })}</dd></div>` : ""}</dl>
<nav class="cl-links" aria-label="More"><a href="/roadmap/">Roadmap</a><a href="https://www.npmjs.com/org/shipvo" rel="noopener">npm</a><a href="https://github.com/shipvo/shipvo/commits/main" rel="noopener">Commits</a></nav>
${months.length > 1 ? `<nav class="cl-months" aria-label="Months">${months.map((m) => `<a href="#${releases.find((r) => r.date?.startsWith(m)).date}">${fmt(m + "-15", { month: "long", year: "numeric" })}</a>`).join("")}</nav>` : ""}</aside>
<ol class="cl-feed" id="cl-feed">${next}${entries}<li data-filter-empty hidden class="fempty">No change matches that search.</li></ol></div>`;
}
