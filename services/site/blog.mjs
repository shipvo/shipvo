// Blog: blog/*.md (front matter + Markdown) → /blog/ index, /blog/<slug>/ posts, covers, RSS.
// Image syntax ![alt](src "caption") renders a <figure> with a visible caption.
import { Marked, Renderer } from "marked";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { symbol } from "./brand.mjs";

const SITE = "https://shipvo.dev";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const GLOW = { Guides: ["#FF9A2E", "#5FB8FF"], Stories: ["#5FB8FF", "#FF9A2E"], Product: ["#7CE3A0", "#5FB8FF"], Agents: ["#B79CFF", "#5FB8FF"], Testing: ["#7CE3A0", "#FF9A2E"], OTA: ["#FF9A2E", "#7CE3A0"] };

function parse(file, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ["title", "date", "author", "tags", "summary"]) if (!meta[k]) throw new Error(`${file}: front matter needs ${k}`);
  const body = m[2].trim();
  const words = body.replace(/```[\s\S]*?```/g, " ").split(/\s+/).length;
  return { slug: file.replace(/\.md$/, ""), ...meta, order: Number(meta.order ?? 99), tags: meta.tags.split(",").map((t) => t.trim()), body, minutes: Math.max(1, Math.round(words / 200)) };
}

function cover(p) {
  const h = [...p.slug].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const PAIRS = [["#FF9A2E", "#5FB8FF"], ["#5FB8FF", "#FF9A2E"], ["#7CE3A0", "#5FB8FF"], ["#B79CFF", "#FF9A2E"], ["#FF9A2E", "#7CE3A0"], ["#5FB8FF", "#B79CFF"]];
  const [a, b] = PAIRS[h % PAIRS.length], cx = 55 + (h >> 3) % 35, cy = 15 + (h >> 5) % 40;
  const sym = Buffer.from(symbol("#F4F2EC")).toString("base64");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" role="img" aria-label="${esc(p.title)}"><defs>
<radialGradient id="a" cx="${cx}%" cy="${cy}%" r="60%"><stop offset="0" stop-color="${a}" stop-opacity=".55"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
<radialGradient id="b" cx="12%" cy="100%" r="55%"><stop offset="0" stop-color="${b}" stop-opacity=".4"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0E1524"/><stop offset="1" stop-color="#070A12"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#a)"/><rect width="1200" height="630" fill="url(#b)"/>
<g stroke="#F4F2EC" stroke-opacity=".07">${Array.from({ length: 12 }, (_, i) => `<path d="M${i * 100} 0V630"/>`).join("")}${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${i * 100}H1200"/>`).join("")}</g>
<image href="data:image/svg+xml;base64,${sym}" x="430" y="150" width="340" height="340"/></svg>`;
}

function render(p) {
  const heads = [];
  const r = new Renderer();
  r.heading = function ({ tokens, depth }) { const t = this.parser.parseInline(tokens), id = slugify(t); if (depth === 2) heads.push({ id, text: t.replace(/<[^>]+>/g, "") }); return `<h${depth} id="${id}">${t}</h${depth}>\n`; };
  r.link = function ({ href, title, tokens }) { const ext = /^https?:/.test(href); return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`; };
  r.code = ({ text, lang }) => `<div class="code"><div class="code-bar"><span>${esc(lang || "text")}</span><button type="button" class="copy" aria-label="Copy code">Copy</button></div><pre><code>${esc(text)}</code></pre></div>`;
  r.image = ({ href, title, text }) => `<figure class="shot"><img src="${esc(href)}" alt="${esc(text)}" width="400" height="866" loading="lazy">${title ? `<figcaption>${esc(title)}</figcaption>` : ""}</figure>`;
  const html = new Marked({ renderer: r, gfm: true }).parse(p.body).replace(/<p>(<figure[\s\S]*?<\/figure>)<\/p>/g, "$1");
  return { html, heads };
}

const tagLink = (t) => `<span class="tag">${esc(t)}</span>`;
const byline = (p) => `<span class="by"><img src="/logo-256.png" alt="" width="28" height="28"><b>${esc(p.author)}</b></span><span>${fmtDate(p.date)}</span><span>${p.minutes} min read</span>`;

export function buildBlog({ ROOT, PUB, headTag, navTag, footTag }) {
  const dir = join(ROOT, "blog");
  const posts = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parse(f, readFileSync(join(dir, f), "utf8"))).sort((a, b) => b.date.localeCompare(a.date) || (a.order - b.order) || a.slug.localeCompare(b.slug));
  const css = '<link rel="stylesheet" href="/docs.css"><link rel="stylesheet" href="/blog.css">';
  const shell = (title, desc, path, main, extra = "") => `<!doctype html><html lang="en"><head>${headTag({ title, desc, path, extraCss: css + extra })}</head><body class="blogpage">${navTag("blog")}<main id="main">${main}</main>${footTag()}<script src="/blog.js" defer></script></body></html>`;

  for (const p of posts) {
    mkdirSync(join(PUB, "blog", p.slug), { recursive: true });
    writeFileSync(join(PUB, "blog", p.slug, "cover.svg"), cover(p));
  }
  const tags = ["All", ...[...new Set(posts.flatMap((p) => p.tags))].sort()];
  const card = (p, lead) => `<article class="pcard${lead ? " lead" : ""}" data-tags="${esc(p.tags.join("|"))}"><a class="pcard-art" href="/blog/${p.slug}/" tabindex="-1" aria-hidden="true"><img src="/blog/${p.slug}/cover.svg" alt="" width="1200" height="630" ${lead ? "" : 'loading="lazy"'}></a><div class="pcard-body"><div class="tags">${p.tags.map(tagLink).join("")}</div><h2><a href="/blog/${p.slug}/">${esc(p.title)}</a></h2><p>${esc(p.summary)}</p><div class="meta">${byline(p)}</div></div></article>`;
  const index = `<section class="blog-top"><div class="wrap"><div class="eyebrow">Blog</div><h1>Stories and guides from the Shipvo team</h1><p class="lede">How to test a mobile app with an assistant, what we found when we tested our own, and what we measured along the way.</p>
<div class="tabs" role="tablist" aria-label="Filter posts">${tags.map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tag="${esc(t)}">${esc(t)} <span>${t === "All" ? posts.length : posts.filter((p) => p.tags.includes(t)).length}</span></button>`).join("")}</div></div></section>
<section class="blog-list"><div class="wrap"><div class="grid" id="posts">${posts.map((p, i) => card(p, i === 0)).join("")}</div><p class="empty" hidden>No posts under this tag yet.</p><p class="feed">Follow along: <a href="/blog/rss.xml">RSS</a> · <a href="https://x.com/HansCadx" rel="noopener">X</a> · <a href="https://github.com/shipvo/shipvo" rel="noopener">GitHub</a></p></div></section>`;
  writeFileSync(join(PUB, "blog", "index.html"), shell("Blog — Shipvo", "Stories and guides from the Shipvo team: testing mobile apps with assistants, what we found, what we measured.", "/blog/", index, '<link rel="alternate" type="application/rss+xml" title="Shipvo blog" href="/blog/rss.xml">'));

  posts.forEach((p, i) => {
    const { html, heads } = render(p);
    const others = posts.filter((x) => x !== p).slice(0, 2);
    const main = `<article class="post"><header class="post-head"><div class="wrap narrow"><a class="back" href="/blog/">← All posts</a><div class="tags">${p.tags.map(tagLink).join("")}</div><h1>${esc(p.title)}</h1><p class="lede">${esc(p.summary)}</p><div class="meta">${byline(p)}</div></div></header>
<div class="wrap narrow"><figure class="hero-fig"><img src="/blog/${p.slug}/cover.svg" alt="" width="1200" height="630"></figure>
${heads.length >= 3 ? `<nav class="contents" aria-label="In this article"><b>In this article</b>${heads.map((h) => `<a href="#${h.id}">${h.text}</a>`).join("")}</nav>` : ""}
<div class="prose">${html}</div>
<div class="share"><span>Share</span><a href="https://x.com/intent/post?text=${encodeURIComponent(p.title)}&url=${encodeURIComponent(`${SITE}/blog/${p.slug}/`)}" rel="noopener">X</a><a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${SITE}/blog/${p.slug}/`)}" rel="noopener">LinkedIn</a><button type="button" data-copy-url>Copy link</button></div>
${others.length ? `<aside class="related"><div class="related-head"><h2>Related articles</h2><a href="/blog/">All posts →</a></div><div class="grid two">${others.map((o) => card(o)).join("")}</div></aside>` : ""}</div></article>`;
    const ld = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, description: p.summary, datePublished: p.date, author: { "@type": "Person", name: p.author }, image: `${SITE}/blog/${p.slug}/cover.svg`, mainEntityOfPage: `${SITE}/blog/${p.slug}/` }).replace(/</g, "\\u003c")}</script>`;
    writeFileSync(join(PUB, "blog", p.slug, "index.html"), shell(`${esc(p.title)} — Shipvo`, esc(p.summary), `/blog/${p.slug}/`, main, ld));
    writeFileSync(join(PUB, "blog", `${p.slug}.md`), `# ${p.title}\n\n> ${p.summary}\n\nBy ${p.author}, ${p.date}. Canonical: ${SITE}/blog/${p.slug}/\n\n${p.body.replace(/\]\((\/[^)\s]*)/g, `](${SITE}$1`)}\n`);
  });

  writeFileSync(join(PUB, "blog", "rss.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Shipvo blog</title><link>${SITE}/blog/</link><description>Stories and guides from the Shipvo team.</description>${posts.map((p) => `<item><title>${esc(p.title)}</title><link>${SITE}/blog/${p.slug}/</link><guid>${SITE}/blog/${p.slug}/</guid><pubDate>${new Date(p.date + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(p.summary)}</description></item>`).join("")}</channel></rss>\n`);
  return posts;
}
