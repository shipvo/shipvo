#!/usr/bin/env node
// Builds shipvo.dev/docs from the repo's Markdown: docs/*.md and each package README, one static page each,
// with a grouped sidebar, a client-side search index, an on-page outline and "edit on GitHub" links.
//   node build-docs.mjs            → public/docs/<slug>/index.html + public/docs/index.json
import { marked } from "marked";
import { head as headTag, nav as navTag, footer as footTag } from "./shell.mjs";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), ROOT = join(here, "..", "..");
const REPO = "https://github.com/shipvo/shipvo/blob/main/";
const NAV = [
  { group: "Get started", pages: [
    { slug: "overview", src: "README.md", title: "What Shipvo is", desc: "One React Native app, two places it runs: phones and AI agents." },
    { slug: "getting-started", src: "docs/getting-started.md", title: "Build your first app", desc: "Twenty minutes from nothing to an app agents can open and phones update over the air." },
    { slug: "new-machine", src: "docs/new-machine.md", title: "Moving to a new machine", desc: "Back up and restore your signing seed, sign in again, keep publishing." },
    { slug: "self-hosting", src: "docs/self-hosting.md", title: "Self-host the control plane", desc: "Run your own on Cloudflare in ten minutes." },
  ]},
  { group: "Agents", pages: [
    { slug: "agents", src: "docs/agents.md", title: "Agents and Shipvo apps", desc: "How an agent sees and operates an app, the MCP tools, hosted access and public listings." },
    { slug: "mcp", src: "packages/mcp/README.md", title: "@shipvo/mcp", desc: "The MCP server: local over stdio, remote over HTTP, hosted with a key." },
  ]},
  { group: "Reference", pages: [
    { slug: "device-api", src: "docs/device-api.md", title: "Device API", desc: "Camera, location, biometrics, payments, notifications: one API, real on phones, simulated for agents." },
    { slug: "cli", src: "packages/cli/README.md", title: "@shipvo/cli", desc: "init, sim, login, app, publish, rollback, keys." },
    { slug: "runtime", src: "packages/runtime/README.md", title: "@shipvo/runtime", desc: "The over-the-air runtime and the Expo config plugin." },
    { slug: "device", src: "packages/device/README.md", title: "@shipvo/device", desc: "The device package and its simulator shims." },
    { slug: "sim", src: "packages/sim/README.md", title: "@shipvo/sim", desc: "The UI simulator: Playwright, accessibility trees, the simulated phone." },
    { slug: "schema", src: "packages/schema/README.md", title: "@shipvo/schema", desc: "Release pointers, envelopes and manifests, as zod schemas." },
  ]},
  { group: "Measured results", pages: [
    { slug: "parity-results", src: "docs/parity-results.md", title: "Simulator vs device parity", desc: "Every screen compared on Android and iOS, gaps included." },
    { slug: "spike-results", src: "docs/spike-results.md", title: "OTA on a 2 GB phone", desc: "Update sizes and timings on a Redmi 9A." },
    { slug: "agent-gate-results", src: "docs/agent-gate-results.md", title: "Agent gate results", desc: "Agents scored by what the backend received." },
  ]},
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const all = NAV.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group })));
const bySrc = Object.fromEntries(all.map((p) => [p.src.replace(/^docs\//, "").replace(/\.md$/, ""), p.slug]));

// Links between docs → site paths; relative repo links → GitHub.
function rewriteHref(href, src) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const clean = href.replace(/^\.\//, "");
  const [path, hash = ""] = clean.split("#");
  const key = path.replace(/^docs\//, "").replace(/\.md$/, "");
  if (bySrc[key]) return `/docs/${bySrc[key]}/${hash ? "#" + hash : ""}`;
  const pkg = path.match(/^packages\/(\w+)\/README\.md$/); if (pkg && bySrc[`packages/${pkg[1]}/README`]) return `/docs/${bySrc[`packages/${pkg[1]}/README`]}/`;
  const base = src.includes("/") ? src.slice(0, src.lastIndexOf("/") + 1) : "";
  return REPO + (path.startsWith("/") ? path.slice(1) : base + path) + (hash ? "#" + hash : "");
}

function render(page) {
  const md = readFileSync(join(ROOT, page.src), "utf8");
  const headings = [];
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) { const text = this.parser.parseInline(tokens); const id = slugify(text); if (depth <= 3) headings.push({ depth, id, text: text.replace(/<[^>]+>/g, "") }); return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>\n`; };
  renderer.link = function ({ href, title, tokens }) { const text = this.parser.parseInline(tokens); const h = rewriteHref(href, page.src); const ext = /^https?:/.test(h); return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${text}</a>`; };
  renderer.code = ({ text, lang }) => `<div class="code"><div class="code-bar"><span>${esc(lang || "text")}</span><button type="button" class="copy" aria-label="Copy code">Copy</button></div><pre><code class="lang-${esc(lang || "text")}">${esc(text)}</code></pre></div>\n`;
  renderer.table = function ({ header, rows }) { const cell = (c) => `<${c.header ? "th" : "td"}${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</${c.header ? "th" : "td"}>`; return `<div class="table-wrap"><table><thead><tr>${header.map(cell).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</tbody></table></div>\n`; };
  marked.use({ renderer, gfm: true });
  let html = marked.parse(md.replace(/^# .*\n/, ""));   // the page title comes from NAV; drop the file's H1
  // Admonitions: a blockquote starting with **Note** / **Warning** becomes a callout.
  html = html.replace(/<blockquote>\s*<p><strong>(Note|Warning|Tip)<\/strong>:?/g, (_, k) => `<blockquote class="callout ${k.toLowerCase()}"><p><strong>${k}</strong>`);
  const text = md.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return { html, headings, text };
}

function layout(page, body, headings, prev, next) {
  const side = NAV.map((g) => `<div class="side-group"><div class="side-title">${esc(g.group)}</div>${g.pages.map((p) => `<a href="/docs/${p.slug}/"${p.slug === page.slug ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`).join("")}</div>`).join("");
  const toc = headings.filter((h) => h.depth === 2 || h.depth === 3).map((h) => `<a href="#${h.id}" class="d${h.depth}">${esc(h.text)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
${headTag({ title: `${esc(page.title)} — Shipvo Docs`, desc: esc(page.desc), path: `/docs/${page.slug}/`, extraCss: '<link rel="stylesheet" href="/docs.css">' })}
</head>
<body class="docs">
${navTag("docs")}
<div class="docs-shell">
  <aside class="side" id="side">
    <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="docsearch" type="search" placeholder="Search docs" aria-label="Search docs" autocomplete="off"><kbd>/</kbd></label>
    <div class="results" id="results" hidden></div>
    ${side}
  </aside>
  <button class="side-toggle" type="button" aria-controls="side" aria-expanded="false">Menu</button>
  <main class="doc">
    <div class="doc-head"><div><div class="eyebrow">${esc(page.group)}</div><h1>${esc(page.title)}</h1><p class="sub">${esc(page.desc)}</p></div><a class="edit" href="${REPO}${page.src}" rel="noopener">Edit on GitHub</a></div>
    <article class="prose">${body}</article>
    <nav class="pager">${prev ? `<a href="/docs/${prev.slug}/"><small>Previous</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a href="/docs/${next.slug}/" class="next"><small>Next</small>${esc(next.title)}</a>` : ""}</nav>
  </main>
  <aside class="toc">${toc ? `<div class="side-title">On this page</div>${toc}` : ""}</aside>
</div>
${footTag()}
<script src="/docs.js" defer></script>
</body>
</html>`;
}

const OUT = join(here, "public", "docs"); mkdirSync(OUT, { recursive: true });
const index = [];
all.forEach((page, i) => {
  if (!existsSync(join(ROOT, page.src))) { console.error("missing", page.src); return; }
  const { html, headings, text } = render(page);
  mkdirSync(join(OUT, page.slug), { recursive: true });
  writeFileSync(join(OUT, page.slug, "index.html"), layout(page, html, headings, all[i - 1], all[i + 1]));
  index.push({ slug: page.slug, title: page.title, group: page.group, desc: page.desc, headings: headings.map((h) => h.text), text: text.slice(0, 6000) });
});
writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
// /docs/ → the overview
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/docs/overview/"><link rel="canonical" href="/docs/overview/"><title>Shipvo Docs</title>`);
console.log(`docs: ${index.length} pages`);

// Site pages: pages/*.html with <!--HEAD …-->, <!--NAV x-->, <!--FOOTER--> stamped in.
import { readdirSync } from "node:fs";
const PUB = join(here, "public");
for (const f of readdirSync(join(here, "pages")).filter((f) => f.endsWith(".html"))) {
  let s = readFileSync(join(here, "pages", f), "utf8");
  s = s.replace(/<!--HEAD (.*?)-->/s, (_, attrs) => { const a = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]])); return headTag(a); });
  s = s.replace(/<!--NAV ?(\w*)-->/, (_, k) => navTag(k)).replace("<!--FOOTER-->", footTag());
  writeFileSync(join(PUB, f), s);
}
// Changelog from CHANGELOG.md
{
  const md = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").replace(/^# .*\n/, "");
  marked.use({ renderer: new marked.Renderer(), gfm: true });
  const body = marked.parse(md);
  mkdirSync(join(PUB, "changelog"), { recursive: true });
  writeFileSync(join(PUB, "changelog", "index.html"), `<!doctype html><html lang="en"><head>${headTag({ title: "Changelog — Shipvo", desc: "What shipped in Shipvo, dated, newest first.", path: "/changelog/" })}</head><body>${navTag("changelog")}<main><section style="border-top:0;padding-top:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Changelog</div><h2 style="margin-top:12px">What shipped.</h2><p class="lede" style="margin-top:14px">Dated, newest first. Package versions are on npm under <code>@shipvo</code>; the full history is the <a class="link" href="https://github.com/shipvo/shipvo/commits/main" rel="noopener">commit log</a>.</p><article class="log">${body}</article></div></section></main>${footTag()}</body></html>`);
}
console.log("pages + changelog built");
