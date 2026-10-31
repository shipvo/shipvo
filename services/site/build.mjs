#!/usr/bin/env node
// Builds shipvo.dev/docs from the repo's Markdown: docs/*.md and each package README, one static page each,
// with a grouped sidebar, a client-side search index, an on-page outline and "edit on GitHub" links.
//   node build-docs.mjs            → public/docs/<slug>/index.html + public/docs/index.json
import { marked } from "marked";
import { head as headTag, nav as navTag, footer as footTag } from "./shell.mjs";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { corona } from "./corona.mjs";
import { mark, symbol, animated } from "./brand.mjs";
import { copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  { group: "Test", pages: [
    { slug: "testing", src: "docs/testing.md", title: "Test your app in CI", desc: "Run your real app flows in the simulator on every pull request, headless, with typed tests. Catch bugs before a human or a phone sees them." },
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
    { slug: "test", src: "packages/test/README.md", title: "@shipvo/test", desc: "Typed simulator tests for Vitest or any runner." },
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
  if (/^(https?:|mailto:|#)/.test(href) || /^\/(docs|apps|brand|changelog|terms|privacy|security|acceptable-use|llms\.txt|llms-full\.txt)(\/|$|#)|^\/(docs\.md|\.well-known\/security\.txt)$/.test(href)) return href;
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
  let html = marked.parse(md.replace(/^# .*\n/, "")).replace(/src="\.github\/assets\/brand\/banner\.png"/g, 'src="/img/brand/banner.webp"');   // the page title comes from NAV; drop the file's H1
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
${headTag({ title: `${esc(page.title)} — Shipvo Docs`, desc: esc(page.desc), path: `/docs/${page.slug}/`, extraCss: `<link rel="stylesheet" href="/docs.css"><link rel="alternate" type="text/markdown" href="/docs/${page.slug}.md">` })}
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
  <main class="doc" id="main">
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
  s = s.replace(/<!--NAV ?(\w*)-->/, (_, k) => navTag(k)).replace("<!--FOOTER-->", footTag()).replace(/<main(?![^>]*\bid=)/, '<main id="main"');
  s = s.replace("<!--CORONA-->", corona({ logoHref: "/logo-256.png", id: "cor" }));
  writeFileSync(join(PUB, f), s);
}
{ // the same artwork as a standalone file (README, social cards, anywhere an <img> works): logo embedded, light and dark aware
  const logo = readFileSync(join(here, "assets", "logo-192.png")).toString("base64");
  mkdirSync(join(PUB, "img"), { recursive: true });
  writeFileSync(join(PUB, "img", "shipvo-corona.svg"), corona({ logoHref: `data:image/png;base64,${logo}`, id: "cor", standalone: true }));
}
// Changelog from CHANGELOG.md
{
  const md = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").replace(/^# .*\n/, "");
  marked.use({ renderer: new marked.Renderer(), gfm: true });
  const body = marked.parse(md);
  mkdirSync(join(PUB, "changelog"), { recursive: true });
  writeFileSync(join(PUB, "changelog", "index.html"), `<!doctype html><html lang="en"><head>${headTag({ title: "Changelog — Shipvo", desc: "What shipped in Shipvo, dated, newest first.", path: "/changelog/" })}</head><body>${navTag("changelog")}<main id="main"><section style="border-top:0;padding-top:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Changelog</div><h2 style="margin-top:12px">What shipped.</h2><p class="lede" style="margin-top:14px">Dated, newest first. Package versions are on npm under <code>@shipvo</code>; the full history is the <a class="link" href="https://github.com/shipvo/shipvo/commits/main" rel="noopener">commit log</a>.</p><article class="log">${body}</article></div></section></main>${footTag()}</body></html>`);
}

// ---------- Legal pages ----------
const LEGAL = [
  { slug: "terms", src: "legal/terms.md", desc: "The rules for using the hosted Shipvo services." },
  { slug: "privacy", src: "legal/privacy.md", desc: "What the hosted Shipvo services collect, why, and who else touches it." },
  { slug: "acceptable-use", src: "legal/acceptable-use.md", desc: "What you may not publish or do with Shipvo." },
  { slug: "security", src: "legal/security.md", desc: "How to report a vulnerability, and how Shipvo is designed to protect you." },
];
const BUILD_DATE = new Date().toISOString().slice(0, 10);
for (const l of LEGAL) {
  const md = readFileSync(join(ROOT, l.src), "utf8");
  const title = md.match(/^# (.*)/)[1], updated = (md.match(/^Last updated: (.*)$/m) || [])[1] || "";
  marked.use({ renderer: new marked.Renderer(), gfm: true });
  const body = marked.parse(md.replace(/^# .*\n/, "").replace(/^Last updated: .*\n/m, ""));
  mkdirSync(join(PUB, l.slug), { recursive: true });
  writeFileSync(join(PUB, l.slug, "index.html"), `<!doctype html><html lang="en"><head>${headTag({ title: `${title} — Shipvo`, desc: l.desc, path: `/${l.slug}/` })}</head><body>${navTag("")}<main id="main"><section style="border-top:0;padding-top:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Legal</div><h1 class="legal-h1">${esc(title)}</h1>${updated ? `<p class="mono small" style="color:var(--dim);margin-top:10px">Last updated ${esc(updated.replace(/^Last updated:?\s*/, ""))}</p>` : ""}<article class="legal">${body}</article><nav class="legal-nav" aria-label="Legal">${LEGAL.map((x) => `<a href="/${x.slug}/"${x.slug === l.slug ? ' aria-current="page"' : ""}>${esc(x.slug === "acceptable-use" ? "Acceptable use" : x.slug[0].toUpperCase() + x.slug.slice(1))}</a>`).join("")}</nav></div></section></main>${footTag()}</body></html>`);
}

// ---------- Machine-readable: per-page .md, docs.md, llms.txt, llms-full.txt, robots, sitemap list, security.txt ----------
const SITE = "https://shipvo.dev";
function mdFor(page) {
  let md = readFileSync(join(ROOT, page.src), "utf8");
  md = md.replace(/<p align="center"><img[^>]*><\/p>\s*/g, "");                         // README banner: decoration only
  md = md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m, bang, text, href, title) => {
    if (bang) return `![${text}](${/^https?:/.test(href) ? href : SITE + "/img/brand/banner.webp"})`;
    let h = rewriteHref(href, page.src);
    const d = h.match(/^\/docs\/([\w-]+)\/(#.*)?$/); if (d) h = `${SITE}/docs/${d[1]}.md`;
    else if (h.startsWith("/")) h = SITE + h;
    return `[${text}](${h}${title || ""})`;
  });
  return md.replace(/^# .*\n/, "").trim();
}
const mdDocs = all.filter((p) => existsSync(join(ROOT, p.src))).map((p) => ({ ...p, md: mdFor(p) }));
for (const p of mdDocs) writeFileSync(join(OUT, `${p.slug}.md`), `# ${p.title}\n\n> ${p.desc}\n\nCanonical page: ${SITE}/docs/${p.slug}/\n\n${p.md}\n`);
const mdList = (pages) => pages.map((p) => `- [${p.title}](${SITE}/docs/${p.slug}.md): ${p.desc}`).join("\n");
const groups = [...new Set(mdDocs.map((p) => p.group))];
writeFileSync(join(PUB, "docs.md"), `# Shipvo documentation\n\n> Every docs page is also available as Markdown at \`/docs/<page>.md\`. Everything in one file: ${SITE}/llms-full.txt\n\n${groups.map((g) => `## ${g}\n\n${mdList(mdDocs.filter((p) => p.group === g))}`).join("\n\n")}\n`);
const FACTS = `Shipvo is an open-source React Native framework: build once, publish for people and AI agents. Phones get signed over-the-air updates; AI agents open the same release in a simulated phone they can see and operate over MCP; parity between the two is measured and published.

Things to know before answering questions about Shipvo:
- Developers test their app in CI with @shipvo/test (typed tests, Vitest or any runner) against the headless simulator on a plain Linux runner: no emulator or device. It catches logic and flow bugs, not native crashes or slow-phone performance.
- The simulator is a simulated device. Camera, location, biometrics, notifications and payments are simulated and labelled (receipts start with SIMULATED-). It is for testing and demonstration, not real transactions.
- AI agents do not yet buy things for real people through Shipvo apps. That needs consent, spend limits and a checkout contract, and is on the roadmap.
- Over-the-air updates run on Android today. iOS is covered by the simulator, not by OTA.
- Hosted services are free during the beta: api.shipvo.dev (control plane) and sim.shipvo.dev (hosted simulator, requires a key from \`npx -y @shipvo/cli login\`). Everything can be self-hosted on Cloudflare.
- Packages are on npm under @shipvo (cli, mcp, runtime, device, sim, schema). Source: https://github.com/shipvo/shipvo`;
const legalLinks = LEGAL.map((l) => `- [${l.slug === "acceptable-use" ? "Acceptable use" : l.slug[0].toUpperCase() + l.slug.slice(1)}](${SITE}/${l.slug}/): ${l.desc}`).join("\n");
writeFileSync(join(PUB, "llms.txt"), `# Shipvo\n\n> ${FACTS.split("\n")[0]}\n\n${FACTS.split("\n").slice(2).join("\n")}\n\n${groups.map((g) => `## ${g}\n\n${mdList(mdDocs.filter((p) => p.group === g))}`).join("\n\n")}\n\n## Product\n\n- [Marketplace](${SITE}/apps): apps listed by their owners that any signed-in agent can open with open_app\n- [Brand](${SITE}/brand): logo, symbols, colours, type and usage rules, with a downloadable kit\n- [Changelog](${SITE}/changelog/): what shipped, dated\n- [All docs in one file](${SITE}/llms-full.txt): the complete documentation as Markdown\n\n## Optional\n\n${legalLinks}\n`);
writeFileSync(join(PUB, "llms-full.txt"), `# Shipvo: full documentation\n\n> ${FACTS.split("\n")[0]}\n\n${FACTS.split("\n").slice(2).join("\n")}\n\n${mdDocs.map((p) => `---\n\n# ${p.title}\n\nSource: ${SITE}/docs/${p.slug}/\n\n${p.md.replace(/^(#{1,6}) /gm, (m, h) => "#".repeat(Math.min(6, h.length + 1)) + " ")}\n`).join("\n")}`);
writeFileSync(join(PUB, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n# For AI tools: ${SITE}/llms.txt and ${SITE}/llms-full.txt\n`);
const staticPaths = ["/", "/apps", "/brand", "/changelog/", ...all.map((p) => `/docs/${p.slug}/`), ...LEGAL.map((l) => `/${l.slug}/`)];
writeFileSync(join(PUB, "sitemap-static.txt"), staticPaths.join("\n") + "\n");
writeFileSync(join(PUB, "security.txt"), `Contact: mailto:hans@pipilot.dev\nExpires: ${new Date(Date.now() + 365 * 864e5).toISOString().replace(/\.\d+Z$/, "Z")}\nPreferred-Languages: en, fr\nCanonical: ${SITE}/.well-known/security.txt\nPolicy: ${SITE}/security/\n`);

// ---------- Brand kit: vectors generated from brand.mjs, PNGs from the final renders, one zip ----------
{
  const B = join(PUB, "brand"); mkdirSync(B, { recursive: true });
  const BR = join(ROOT, ".github", "assets", "brand");
  writeFileSync(join(B, "shipvo-mark.svg"), mark());
  writeFileSync(join(B, "shipvo-symbol-light.svg"), symbol("#F4F2EC"));
  writeFileSync(join(B, "shipvo-symbol-dark.svg"), symbol("#090D16"));
  writeFileSync(join(B, "shipvo-logo-animated.svg"), animated());
  for (const [from, to] of [[join(BR, "mark-1024.png"), "shipvo-mark-1024.png"], [join(BR, "mark-512.png"), "shipvo-mark-512.png"], [join(BR, "favicon-64.png"), "shipvo-favicon-64.png"], [join(BR, "banner.png"), "shipvo-banner.png"], [join(PUB, "wordmark.png"), "shipvo-lockup.png"]]) if (existsSync(from)) copyFileSync(from, join(B, to));
  const files = ["shipvo-mark.svg", "shipvo-symbol-light.svg", "shipvo-symbol-dark.svg", "shipvo-logo-animated.svg", "shipvo-mark-1024.png", "shipvo-mark-512.png", "shipvo-favicon-64.png", "shipvo-lockup.png", "shipvo-banner.png"].filter((f) => existsSync(join(B, f)));
  const KIT = join(here, ".kit", "shipvo-brand-kit"); rmSync(join(here, ".kit"), { recursive: true, force: true }); mkdirSync(KIT, { recursive: true });
  for (const f of files) copyFileSync(join(B, f), join(KIT, f));
  writeFileSync(join(KIT, "README.txt"), `Shipvo brand kit\n${SITE}/brand\n\nMARK         shipvo-mark.svg (full colour), PNGs at 1024 / 512 / 64\nSYMBOL       shipvo-symbol-light.svg (for dark backgrounds), shipvo-symbol-dark.svg (for light backgrounds and print)\nANIMATED     shipvo-logo-animated.svg (plays in browsers; for arrivals and loading, not as a decorative loop)\nLOCKUP       shipvo-lockup.png (mark + wordmark + tagline, on dark); shipvo-banner.png (1672 x 941)\n\nCOLOUR       Ink #090D16 | Ink 2 #0F1522 | Orange #FF9A2E | Sky #5FB8FF | Paper #F4F2EC | Mute #B6BDCB\nTYPE         Bricolage Grotesque (800 headlines, 500 body), JetBrains Mono (code, labels) - both open-source Google Fonts\nNAME         Shipvo (one word, capital S)\n\nRULES        Keep clear space of at least 1/4 of the mark's width. Minimum 24 px on screen, 8 mm in print.\n             Do not stretch, recolour, rotate, add effects, or place on busy backgrounds.\n\nLICENCE      The Shipvo code is Apache-2.0. That licence does not grant rights to the name or logo.\n             Saying your app is built with Shipvo, or showing the mark in an article, talk or integrations list, is fine.\n             Do not suggest Shipvo endorses your product. For anything larger: hans@pipilot.dev\n`);
  try { rmSync(join(B, "shipvo-brand-kit.zip"), { force: true }); execFileSync("zip", ["-qr", join(B, "shipvo-brand-kit.zip"), "shipvo-brand-kit"], { cwd: join(here, ".kit") }); }
  catch (e) { console.error("zip not available, brand kit zip skipped:", e.message); }
  rmSync(join(here, ".kit"), { recursive: true, force: true });
}

console.log("pages + changelog + legal + llms + brand built");
