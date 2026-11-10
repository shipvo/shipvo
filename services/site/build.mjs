#!/usr/bin/env node
// Builds shipvo.dev/docs from the repo's Markdown: docs/*.md and each package README, one static page each,
// with a grouped sidebar, a client-side search index, an on-page outline and "edit on GitHub" links.
//   node build-docs.mjs            → public/docs/<slug>/index.html + public/docs/index.json
import { marked } from "marked";
import { transformPhones } from "./phone-embed.mjs";
import { head as headTag, nav as navTag, footer as footTag, crumbs } from "./shell.mjs";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { corona } from "./corona.mjs";
import { buildBlog } from "./blog.mjs";
import { parseRoadmap, renderRoadmap, fetchProgress } from "./roadmap.mjs";
import { parseChangelog, renderChangelog } from "./changelog.mjs";
import { mark, symbol, animated } from "./brand.mjs";
import { copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), ROOT = join(here, "..", "..");
const REPO = "https://github.com/shipvo/shipvo/blob/main/";
// Last-modified date of a source file: the commit date when git history is available, otherwise today.
const lastmod = (src) => { try { const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", src], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); if (d) return d; } catch {} return new Date().toISOString().slice(0, 10); };
const NAV = [
  { group: "Get started", pages: [
    { slug: "overview", src: "README.md", title: "What Shipvo is", desc: "Shipvo is an open-source React Native framework: signed over-the-air updates for phones and a simulator AI agents operate over MCP." },
    { slug: "getting-started", src: "docs/getting-started.md", title: "Build your first app", desc: "Twenty minutes from nothing to a React Native app that AI agents can open in a simulator and phones update over the air." },
    { slug: "playground", src: "docs/playground.md", title: "Playground: try Shipvo in your browser", desc: "Try a sample app on an Android phone and an iPhone in your browser, with device features, signed updates and rollback, and a shareable many-phones link." },
    { slug: "run", src: "docs/run.md", title: "Run on a phone in your browser", desc: "Run your app on a simulated Android or iPhone in your own browser with shipvo run, no Playwright, and let your AI assistant drive the same phone." },
    { slug: "lumi", src: "docs/lumi.md", title: "Lumi on Shipvo Phone", desc: "Watch Lumi show each step on the phone, react to failures, and test your app for you with shipvo lumi. No AI account needed." },
    { slug: "lumi-bench", src: "docs/lumi-bench.md", title: "Lumi benchmark", desc: "Run the Lumi benchmark on the sample apps with a seed and read the measured screens, flows and bugs found." },
    { slug: "lumi-ranker", src: "docs/lumi-ranker.md", title: "Lumi action ranker", desc: "How Lumi picks its next action, and what the optional ranker model measured on a held-out app." },
    { slug: "describe-an-app", src: "docs/describe-an-app.md", title: "Describe an app and it appears", desc: "Ask your coding agent for a small app and it appears on an Android or iOS phone; change it later and keep what people entered, with every tool and error explained." },
    { slug: "phone-apps", src: "docs/phone-apps.md", title: "Phone Browser, Settings and system controls", desc: "Change dark mode, text size and language, open web pages and use the home screen, shade and power button on the simulated phone." },
    { slug: "phone-updates", src: "docs/phone-updates.md", title: "OTA updates on the phone", desc: "Publish a release, watch it land on the simulated Android or iOS phone, apply it and see a bad one roll back." },
    { slug: "phone-network", src: "docs/phone-network.md", title: "Network calls on the hosted phone", desc: "How the hosted phone sends your app's HTTP calls through a request proxy, the same on Android and iOS." },
    { slug: "new-machine", src: "docs/new-machine.md", title: "Moving to a new machine", desc: "Move your Shipvo project to a new computer: back up and restore your release signing seed, sign in again and keep publishing updates." },
    { slug: "key-rotation", src: "docs/key-rotation.md", title: "Key rotation", desc: "Create an offline root key and replace your update signing key without a new store build." },
    { slug: "rollbacks-and-stored-data", src: "docs/rollbacks-and-stored-data.md", title: "Rollbacks and stored data", desc: "Declare a state version with each release so shipvo rollback stops before it sends phones to code that cannot read their saved data." },
    { slug: "self-hosting", src: "docs/self-hosting.md", title: "Self-host the control plane", desc: "Self-host the Shipvo control plane on Cloudflare Workers, KV and D1 in about ten minutes, with your own keys and no per-user fees." },
  ]},
  { group: "Ship", pages: [
    { slug: "cli-commands", src: "docs/cli.md", title: "CLI guide", desc: "Every Shipvo command with examples: init, preview, publish policy checks, auto-halt and audit export, and fixes for common errors." },
    { slug: "migrate-from-codepush", src: "docs/migrate-from-codepush.md", title: "Migrate from CodePush", desc: "Move a React Native app from react-native-code-push to Shipvo signed over-the-air updates, step by step, with real dry-run output." },
    { slug: "migrate-from-eas-update", src: "docs/migrate-from-eas-update.md", title: "Migrate from EAS Update", desc: "Move an Expo app from EAS Update to Shipvo signed over-the-air updates with shipvo migrate --plan and --apply, step by step." },
    { slug: "store", src: "docs/store.md", title: "Store details and screenshots", desc: "Draft Google Play and App Store details from shipvo.json and check screenshot sizes before you submit. Nothing is uploaded." },
    { slug: "capacitor", src: "docs/capacitor.md", title: "Capacitor apps in your own CI", desc: "Build signed Android and iOS binaries for a Capacitor app in your own GitHub Actions, with no EAS account needed." },
    { slug: "adapters", src: "docs/adapters.md", title: "Adapters for other runtimes", desc: "What a runtime port must do, which release-decision rules exist and where each lives, for maintainers adding a framework adapter." },
    { slug: "telemetry-export", src: "docs/telemetry-export.md", title: "Telemetry export with SQL", desc: "Copy release telemetry to your own R2 bucket as Parquet files and query it with DuckDB, Spark or an agent. No Shipvo API in the way." },
    { slug: "auto-halt", src: "docs/auto-halt.md", title: "Auto-halt a failing release", desc: "Stop a release automatically when it fails on many real installs: what counts as a vote, how to turn it on and how to read the result." },
    { slug: "sso", src: "docs/sso.md", title: "Single sign-on (OIDC)", desc: "Let people sign in to the dashboard with your identity provider and get the role their claims map to." },
    { slug: "taking-real-orders", src: "docs/taking-real-orders.md", title: "Taking real orders", desc: "How Shipvo stores the orders your app sends and how you, or your payment provider, tell Shipvo an order is paid." },
  ]},
  { group: "Test", pages: [
    { slug: "test-with-an-assistant", src: "docs/test-with-an-assistant.md", title: "Test with an assistant", desc: "Connect Claude, ChatGPT or Cursor to the hosted Shipvo simulator over MCP and have it test your React Native app, step by step." },
    { slug: "testing", src: "docs/testing.md", title: "Test your app in CI", desc: "Run your real React Native app flows in a headless simulator on every pull request, with typed Vitest tests. No emulator, no device farm." },
    { slug: "email-sign-in", src: "docs/email-sign-in.md", title: "Test an email sign-in", desc: "Give every test session a private inbox so a test or an agent can read an emailed code or magic link and finish sign-in on Android and iOS." },
    { slug: "spec-blocks", src: "docs/spec-blocks.md", title: "App spec: screens and controls", desc: "Write a Shipvo app spec with charts, boards, calendars, maps and live data, copy a gallery example, check it, and render it the same on Android and iOS." },
    { slug: "ci-check", src: "docs/ci-check.md", title: "Check every pull request", desc: "Add one workflow so every pull request builds your app, runs your Shipvo flows and explores every button. Fails on regressions and crashes only." },
    { slug: "test-your-build", src: "docs/test-your-build.md", title: "Test your build on the hosted phone", desc: "Upload the build on your machine with shipvo sim --hosted or upload_build, then open it as a hosted phone session on Android and iOS." },
    { slug: "eval", src: "docs/eval.md", title: "Score an agent on an app task", desc: "Run any coding agent or model on a task with shipvo eval, then get measured pass rate, steps, time, errors and retries on Android and iOS." },
    { slug: "timeline", src: "docs/timeline.md", title: "Behaviour timeline", desc: "See every release and pull request check run in one list, with flows, findings and screens, and compare any two points on Android and iOS." },
  ]},
  { group: "Agents", pages: [
    { slug: "agents", src: "docs/agents.md", title: "Agents and Shipvo apps", desc: "How an AI agent sees and operates a Shipvo app over MCP: the accessibility tree, every tool, hosted access and public listings." },
    { slug: "record", src: "docs/record.md", title: "Record a demo video", desc: "Have your assistant record an MP4 of the phone with chapter markers using record_start, record_marker and record_stop, for store pages and bug reports." },
    { slug: "record-a-demo-video", src: "docs/record-a-demo-video.md", title: "Record a demo video: worked example", desc: "A worked example for founders: have your assistant record an MP4 of your app with chapters, music and a voice track." },
    { slug: "demo-chess", src: "docs/demos/chess.md", title: "Chess on two phones", desc: "Watch an Android phone and an iPhone play chess in your browser, or run it and let two assistants play a full game through MCP." },
    { slug: "mcp", src: "packages/mcp/README.md", title: "@shipvo/mcp", desc: "The @shipvo/mcp server for AI agents: run it locally over stdio, remotely over HTTP, or hosted with a key. Config for Claude, Cursor, ChatGPT." },
  ]},
  { group: "Reference", pages: [
    { slug: "device-api", src: "docs/device-api.md", title: "Device API", desc: "One device API for camera, location, biometrics, payments and notifications: real on phones, simulated and labelled for agents and tests." },
    { slug: "cli", src: "packages/cli/README.md", title: "@shipvo/cli", desc: "The @shipvo/cli reference: init, sim, login, app, publish, rollback and keys commands for building and shipping React Native apps." },
    { slug: "runtime", src: "packages/runtime/README.md", title: "@shipvo/runtime", desc: "@shipvo/runtime: the Expo module and config plugin that verify, patch and apply signed over-the-air updates, with crash-loop rollback." },
    { slug: "device", src: "packages/device/README.md", title: "@shipvo/device", desc: "@shipvo/device: the device package and its simulator shims for camera, location, biometrics, payments and notifications in React Native." },
    { slug: "test", src: "packages/test/README.md", title: "@shipvo/test", desc: "@shipvo/test: typed end-to-end tests for React Native apps in Vitest or any runner, running against the headless Shipvo simulator in CI." },
    { slug: "sim", src: "packages/sim/README.md", title: "@shipvo/sim", desc: "@shipvo/sim: the headless simulator that runs your app in Playwright and exposes accessibility trees and a simulated phone to agents and tests." },
    { slug: "schema", src: "packages/schema/README.md", title: "@shipvo/schema", desc: "@shipvo/schema: zod schemas for Shipvo release pointers, signed envelopes, shell manifests, gate reports and telemetry." },
    { slug: "spec", src: "packages/spec/README.md", title: "@shipvo/spec", desc: "@shipvo/spec: the app spec JSON Schema, validator, expression evaluator and renderer for Android and iOS screens." },
    { slug: "app-spec-validator", src: "docs/app-spec-validator.md", title: "App spec validator", desc: "Check a Shipvo app spec before a phone opens it: read each error with its path and fix, and set network and write permissions." },
  ]},
  { group: "Measured results", pages: [
    { slug: "parity-results", src: "docs/parity-results.md", title: "Simulator vs device parity", desc: "Simulator vs device parity: every screen of three purchase flows compared on Android and iOS, with the method and every result." },
    { slug: "spike-results", src: "docs/spike-results.md", title: "OTA on a 2 GB phone", desc: "Measured on a 2 GB Redmi 9A in Douala: update size, apply time, cold start, rollback and crash-loop revert, with the raw timeline." },
    { slug: "sim-bench", src: "docs/sim-bench.md", title: "Simulator cost", desc: "Measured session start time and memory for the Shipvo simulator, with the script that measures them on your machine." },
    { slug: "lumi-bench", src: "docs/lumi-bench.md", title: "Lumi benchmark", desc: "A repeatable benchmark for Lumi Autotest: screens reached, flows finished and planted bugs found, with measured results." },
    { slug: "android-crash-loop-paths", src: "docs/android-crash-loop-paths.md", title: "Crash-loop revert on Android", desc: "How an Android phone reverts a release that keeps crashing: the trial path, the promoted path, the 3-boot limit and the 60 s window." },
    { slug: "agent-gate-results", src: "docs/agent-gate-results.md", title: "Agent gate results", desc: "How AI agents scored on real purchase tasks in a React Native app, graded by what the backend received, not what the agent said." },
  ]},
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
import { parseMinutes, TYPES, GOALS, LEVELS, TIMES } from "./public/learn-search.js";
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const docPages = NAV.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group, base: "docs" })));
const url = (p) => `/${p.base || "docs"}/${p.slug}/`;

// ---------- Learn: tutorials, videos and glossary, built from docs/tutorials/*.md, docs/videos.md and docs/glossary.md ----------
const clipText = (s, n = 160) => { s = s.replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const c = s.slice(0, n + 1), d = c.lastIndexOf(". "); return d > n * 0.5 ? c.slice(0, d + 1) : c.slice(0, c.lastIndexOf(" ")) + "…"; };
const plain = (s) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`_]/g, "");
// The hub index (docs/tutorials/index.md) says which goal group each tutorial is in, and its time and level.
const tutorialMeta = {};
{
  let group = "";
  for (const line of readFileSync(join(ROOT, "docs/tutorials/index.md"), "utf8").split("\n")) {
    const h = line.match(/^## (.+)/); if (h) { group = h[1].trim(); continue; }
    const r = line.match(/^\|\s*\[[^\]]+\]\(([\w-]+)\.md\)\s*\|(.*)\|(.*)\|(.*)\|\s*$/);
    if (r) tutorialMeta[r[1]] = { group, time: plain(r[3]).trim(), level: plain(r[4]).trim() };
  }
}
const tutorials = readdirSync(join(ROOT, "docs/tutorials")).filter((f) => f.endsWith(".md") && f !== "index.md").map((f) => {
  const slug = f.replace(/\.md$/, ""), src = `docs/tutorials/${f}`, md = readFileSync(join(ROOT, src), "utf8");
  const own = md.match(/\*\*Level:\*\*\s*([^.]+)\./), ownTime = md.match(/\*\*Time:\*\*\s*([^.]+)\./);
  const m = tutorialMeta[slug] || {};
  const firstPara = md.replace(/^# .*\n/, "").split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !x.startsWith("**Level") && !x.startsWith("**Time") && !x.startsWith("<") && !x.startsWith("#") && !/^Prefer to watch/i.test(x) && !/^Music:/i.test(x) && !/^>/.test(x));
  return { slug, src, base: "learn", group: m.group || "More", kind: "tutorial", title: md.match(/^# (.*)/)?.[1] ?? slug, desc: clipText(plain(firstPara || "")), time: m.time || ownTime?.[1] || "", level: m.level || (own ? own[1][0].toUpperCase() + own[1].slice(1) : ""), date: lastmod(src) };
}).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
const videosMd = readFileSync(join(ROOT, "docs/videos.md"), "utf8");
const videos = [...videosMd.matchAll(/^#{2,3} (.+)\n+<video\b([^>]*)>/gm)].map((m) => { const a = (n) => m[2].match(new RegExp(`${n}="([^"]*)"`))?.[1] ?? ""; const before = videosMd.slice(0, m.index), rest = videosMd.slice(m.index + m[0].length); const body = rest.slice(0, rest.search(/\n#{2,3} /) < 0 ? undefined : rest.search(/\n#{2,3} /)); return { title: m[1].trim(), id: slugify(m[1]), poster: a("poster"), length: a("data-length"), group: before.match(/^## (.+)$(?![\s\S]*^## )/m)?.[1].trim() ?? "", text: plain(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }; });
const glossaryTerms = [...readFileSync(join(ROOT, "docs/glossary.md"), "utf8").matchAll(/^\*\*(.+?)\.\*\*\s*(.+)$/gm)].map((m) => ({ title: m[1], id: `term-${slugify(m[1])}`, text: plain(m[2]) }));
const VIDEO_GOAL = { "Get started": "start" };
const GROUP_ORDER = ["Start", "Sell", "Run your app", "Test", "Ship updates"];
const learnPages = [
  { slug: "videos", src: "docs/videos.md", title: "Videos", desc: "Short captioned videos that show how Shipvo works: over-the-air updates, signing, staged rollout and rollback, in plain words." },
  { slug: "glossary", src: "docs/glossary.md", title: "Glossary", desc: "Plain-English meanings for the words Shipvo docs and tutorials use, such as terminal, simulator, release and over the air." },
].map((p) => ({ ...p, base: "learn", group: "Learn" }));
const learnAll = [...tutorials.map((t) => ({ ...t, group: "Tutorials" })), ...learnPages];
const all = [...docPages, ...learnAll];
const bySrc = { ...Object.fromEntries(all.map((p) => [p.src.replace(/^docs\//, "").replace(/\.md$/, ""), url(p)])), "tutorials/index": "/learn/" };

// Links between docs → site paths; relative repo links → GitHub.
function rewriteHref(href, src) {
  if (/^(https?:|mailto:|#)/.test(href) || /^\/(docs|learn|apps|brand|changelog|roadmap|terms|privacy|security|acceptable-use|llms\.txt|llms-full\.txt)(\/|$|#)|^\/(docs\.md|\.well-known\/security\.txt)$/.test(href)) return href;
  let clean = href.replace(/^\.\//, "");
  if (src.includes("/") && /^\.\.\//.test(clean)) clean = join(src.slice(0, src.lastIndexOf("/")), clean).replace(/\\/g, "/");   // ../x.md from docs/tutorials/ → docs/x.md
  else if (src.startsWith("docs/tutorials/") && /^[\w-]+\.md/.test(clean)) clean = "docs/tutorials/" + clean;
  const [path, hash = ""] = clean.split("#");
  const key = path.replace(/^docs\//, "").replace(/\.md$/, "");
  if (bySrc[key]) return `${bySrc[key]}${hash ? "#" + hash : ""}`;
  const pkg = path.match(/^packages\/(\w+)\/README\.md$/); if (pkg && bySrc[`packages/${pkg[1]}/README`]) return bySrc[`packages/${pkg[1]}/README`];
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
  html = transformPhones(html);   // live phone embeds (issue #420)
  if (page.slug === "glossary") html = html.replace(/<p><strong>([^<]+?)\.<\/strong>/g, (m, t) => `<p id="term-${slugify(t)}"><strong>${t}.</strong>`);   // link targets for search (issue #456)
  // Admonitions: a blockquote starting with **Note** / **Warning** becomes a callout.
  html = html.replace(/<blockquote>\s*<p><strong>(Note|Warning|Tip)<\/strong>:?/g, (_, k) => `<blockquote class="callout ${k.toLowerCase()}"><p><strong>${k}</strong>`);
  const text = md.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return { html, headings, text };
}

function layout(page, body, headings, prev, next) {
  const learn = page.base === "learn";
  const link = (p) => `<a href="${url(p)}"${p === page ? ' aria-current="page"' : ""}>${esc(p.title)}</a>`;
  const groups = learn
    ? [{ group: "Learn", html: '<a href="/learn/">All of Learn</a><a href="/setup/">Set up with your agent</a>' }, { group: "Tutorials", pages: tutorials }, { group: "Videos", html: `<a href="/learn/videos/">All videos</a>${videos.map((v) => `<a href="/learn/videos/#${v.id}">${esc(v.title)}</a>`).join("")}` }, { group: "Glossary", html: `<a href="/learn/glossary/">All terms</a>${glossaryTerms.map((g) => `<a href="/learn/glossary/#${g.id}">${esc(g.title)}</a>`).join("")}` }]
    : NAV.map((g) => g.group === "Get started" ? { ...g, html: '<a href="/learn/">Learn: tutorials and videos</a><a href="/setup/">Set up with your agent</a>' } : g);
  const side = groups.map((g) => `<div class="side-group"><div class="side-title">${esc(g.group)}</div>${(g.pages || []).map(link).join("")}${g.html || ""}</div>`).join("");
  const section = learn ? ["Learn", "/learn/", "learn"] : ["Docs", "/docs/overview/", "docs"];
  const toc = headings.filter((h) => h.depth === 2 || h.depth === 3).map((h) => `<a href="#${h.id}" class="d${h.depth}">${esc(h.text)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
${headTag({ title: `${esc(page.title)} — Shipvo ${learn ? "Learn" : "Docs"}`, desc: esc(page.desc), path: url(page), type: "article", image: "/og/docs.png", imageAlt: "Shipvo documentation", modified: lastmod(page.src), ld: [crumbs([["Home", "/"], [section[0], section[1]], [page.title, url(page)]]), { "@context": "https://schema.org", "@type": "TechArticle", headline: page.title, description: page.desc, dateModified: lastmod(page.src), author: { "@type": "Person", name: "Hans Ade" }, publisher: { "@type": "Organization", name: "Shipvo", url: "https://shipvo.dev" }, mainEntityOfPage: `https://shipvo.dev${url(page)}`, inLanguage: "en" }], extraCss: `<link rel="stylesheet" href="/docs.css"><link rel="alternate" type="text/markdown" href="${url(page).slice(0, -1)}.md">` })}
</head>
<body class="docs">
${navTag(section[2])}
<div class="docs-shell">
  <aside class="side" id="side">
    ${learn ? `<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="sidefilter" type="search" placeholder="Filter Learn" aria-label="Filter the Learn menu" autocomplete="off"><kbd>/</kbd></label>
    <p class="side-empty" id="side-empty" hidden>Nothing matches. <a href="/learn/">Search all of Learn</a></p>` : `<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="docsearch" type="search" placeholder="Search docs and Learn" aria-label="Search docs" autocomplete="off"><kbd>/</kbd></label>
    <div class="results" id="results" hidden></div>`}
    ${side}
  </aside>
  <button class="side-toggle" type="button" aria-controls="side" aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h16"/></svg><span>${learn ? "Learn menu" : "Docs menu"}</span></button>
  <main class="doc" id="main">
    <div class="doc-head"><div><div class="eyebrow">${esc(page.group)}</div><h1>${esc(page.title)}</h1><p class="sub">${esc(page.desc)}</p></div><a class="edit" href="${REPO}${page.src}" rel="noopener">Edit on GitHub</a></div>
    <article class="prose">${body}</article>
    <nav class="pager">${prev ? `<a href="${url(prev)}"><small>Previous</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a href="${url(next)}" class="next"><small>Next</small>${esc(next.title)}</a>` : ""}</nav>
  </main>
  <aside class="toc">${toc ? `<div class="side-title">On this page</div>${toc}` : ""}</aside>
</div>
${footTag()}
<script src="/docs.js" defer></script>${learn ? '<script src="/learn-side.js" defer></script>' : ""}
<script src="/phone.js" defer></script>
</body>
</html>`;
}

const OUT = join(here, "public", "docs"); mkdirSync(OUT, { recursive: true });
const index = [];
const LOUT = join(here, "public", "learn"); mkdirSync(LOUT, { recursive: true });
for (const list of [docPages, learnAll]) list.forEach((page, i) => {
  if (!existsSync(join(ROOT, page.src))) { console.error("missing", page.src); return; }
  const { html, headings, text } = render(page);
  const dir = join(page.base === "learn" ? LOUT : OUT, page.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), layout(page, html, headings, list[i - 1] ?? (page.base === "learn" ? { slug: "", base: "learn", title: "Learn" } : undefined), list[i + 1]));
  index.push({ slug: page.slug, path: url(page), title: page.title, group: page.group, desc: page.desc, headings: headings.map((h) => h.text), text: text.slice(0, 6000) });
});
writeFileSync(join(OUT, "index.json"), JSON.stringify(index));

// ---------- Learn hub: /learn/ lists every tutorial and video, generated from the source files ----------
{
  const tutorialCard = (t) => `<a class="lcard" href="${url(t)}"><span class="lgroup">${esc(t.group)}</span><b>${esc(t.title)}</b><span class="ldesc">${esc(t.desc)}</span><span class="lmeta">${t.time ? `<span>${esc(t.time)}</span>` : ""}${t.level ? `<span>${esc(t.level)}</span>` : ""}</span></a>`;
  const videoCard = (v) => `<a class="lcard lvideo" href="/learn/videos/#${v.id}">${v.poster ? `<img src="${esc(v.poster)}" alt="" loading="lazy" width="640" height="360">` : ""}<b>${esc(v.title)}</b><span class="lmeta"><span>${esc(v.length)}</span><span>Captions and transcript</span></span></a>`;
  // Search index for the hub (issue #456): titles, descriptions, headings and transcripts, built here so search needs no network round trip beyond this file.
  const goalSlug = (g) => slugify(g);
  const learnIndex = [
    ...tutorials.map((t) => { const e = index.find((x) => x.path === url(t)); return { type: "tutorial", title: t.title, desc: t.desc, path: url(t), goal: goalSlug(t.group), level: slugify(t.level), minutes: parseMinutes(t.time), time: t.time, headings: e?.headings ?? [], text: (e?.text ?? "").slice(0, 6000) }; }),
    ...videos.map((v) => ({ type: "video", title: v.title, desc: `Video, ${v.length}.`, path: `/learn/videos/#${v.id}`, goal: VIDEO_GOAL[v.group] ?? goalSlug(v.group), level: "", minutes: parseMinutes(v.length), time: v.length, poster: v.poster, headings: [], text: v.text.slice(0, 8000) })),
    ...glossaryTerms.map((g) => ({ type: "glossary", title: g.title, desc: clipText(g.text), path: `/learn/glossary/#${g.id}`, goal: "", level: "", minutes: null, time: "", headings: [], text: g.text })),
  ].map((e, order) => ({ ...e, order }));
  writeFileSync(join(LOUT, "index.json"), JSON.stringify(learnIndex));
  const chips = (key, label, opts) => `<fieldset class="lfilter" data-key="${key}"><legend>${label}</legend>${opts.map(([v, l]) => `<button type="button" class="chip" data-value="${v}" aria-pressed="false">${l}<span class="n"></span></button>`).join("")}</fieldset>`;
  const groups = [...new Set([...GROUP_ORDER, ...tutorials.map((t) => t.group)])].filter((g) => tutorials.some((t) => t.group === g));
  const desc = "Tutorials, videos and a glossary for people who are new to Shipvo, in plain words. No coding or terminal experience needed.";
  mkdirSync(LOUT, { recursive: true });
  writeFileSync(join(LOUT, "index.html"), `<!doctype html><html lang="en"><head>${headTag({ title: "Learn Shipvo: tutorials, videos and glossary", desc, path: "/learn/", ld: [crumbs([["Home", "/"], ["Learn", "/learn/"]])], extraCss: '<link rel="stylesheet" href="/learn.css">' })}</head><body>${navTag("learn")}<main id="main"><section class="learn"><div class="wrap">
<div class="eyebrow">Learn</div><h1>Learn Shipvo, one small step at a time.</h1>
<p class="lede">You do not need to be a developer. These tutorials take you from nothing to an app on a simulated phone in your browser. Each one says how long it takes and who it is for, and every new word is explained once in the <a class="link" href="/learn/glossary/">glossary</a>.</p>
<form class="lsearch" role="search" id="lsearch" onsubmit="return false"><label for="lq" class="sr">Search tutorials, videos and the glossary</label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="lq" type="search" placeholder="Search tutorials, videos and words" autocomplete="off" autofocus><kbd>/</kbd></form>
<div class="lfilters" id="lfilters">${chips("type", "Type", TYPES)}${chips("goal", "Goal", GOALS)}${chips("level", "Level", LEVELS)}${chips("time", "Time", TIMES)}<button type="button" class="lclear" id="lclear" hidden>Clear all</button></div>
<p class="lcount" id="lcount" role="status" aria-live="polite" hidden></p>
<div class="lgrid" id="lresults" hidden></div>
<div id="lstatic">
<h2 id="tutorials">Tutorials</h2><p class="lsub">Newest first. Tutorials are grouped by what you want to do: ${groups.map(esc).join(", ")}.</p>
<div class="lgrid">${tutorials.map(tutorialCard).join("")}</div>
<h2 id="videos">Videos</h2><p class="lsub">Short, captioned, with a written transcript. <a class="link" href="/learn/videos/">All videos</a></p>
<div class="lgrid">${videos.map(videoCard).join("")}</div>
<h2 id="glossary">Glossary</h2><p class="lsub">Stuck on a word? <a class="link" href="/learn/glossary/">Open the glossary</a> for plain-English meanings.</p>
</div>
<h2 id="setup">Set up with your agent</h2><p class="lsub">Let your coding agent do the setup. <a class="link" href="/setup/">Three ways to install Shipvo for it</a>.</p>
<h2 id="next">Next: Docs</h2><p class="lsub">Ready for reference material? Go to the <a class="link" href="/docs/overview/">Docs</a>, or start with <a class="link" href="/docs/getting-started/">Build your first app</a>.</p>
</div></section></main>${footTag()}<script type="module" src="/learn.js"></script></body></html>`);
}
// /docs/ → the overview
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/docs/overview/"><link rel="canonical" href="/docs/overview/"><title>Shipvo Docs</title>`);
console.log(`docs: ${index.length} pages`);

// Site pages: pages/*.html with <!--HEAD …-->, <!--NAV x-->, <!--FOOTER--> stamped in.
const PUB = join(here, "public");
for (const f of readdirSync(join(here, "pages")).filter((f) => f.endsWith(".html"))) {
  let s = readFileSync(join(here, "pages", f), "utf8");
  const PAGE_LD = {
    "index.html": [{ "@context": "https://schema.org", "@type": "Organization", name: "Shipvo", url: "https://shipvo.dev", logo: "https://shipvo.dev/logo-256.png", sameAs: ["https://github.com/shipvo/shipvo", "https://www.npmjs.com/org/shipvo", "https://x.com/HansCadx"], founder: { "@type": "Person", name: "Hans Ade", url: "https://x.com/HansCadx" } },
      { "@context": "https://schema.org", "@type": "WebSite", name: "Shipvo", url: "https://shipvo.dev", description: "Open-source React Native framework: signed over-the-air updates for phones and a simulator AI agents operate over MCP." },
      { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Shipvo", applicationCategory: "DeveloperApplication", operatingSystem: "Android, iOS, Linux, macOS, Windows", description: "Open-source React Native framework with signed over-the-air updates, a headless simulator AI agents operate over MCP, and typed end-to-end tests for CI.", url: "https://shipvo.dev", license: "https://www.apache.org/licenses/LICENSE-2.0", codeRepository: "https://github.com/shipvo/shipvo", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }],
    "compare.html": [crumbs([["Home", "/"], ["Shipvo vs Expo", "/compare/"]])],
    "features.html": [crumbs([["Home", "/"], ["Features", "/features/"]])],
    "pricing.html": [crumbs([["Home", "/"], ["Pricing", "/pricing/"]])],
    "apps.html": [crumbs([["Home", "/"], ["Apps", "/apps"]])],
    "brand.html": [crumbs([["Home", "/"], ["Brand", "/brand"]])],
    "setup.html": [crumbs([["Home", "/"], ["Set up with your agent", "/setup/"]])],
    "products-simulators.html": [crumbs([["Home", "/"], ["Product", "/features/"], ["Simulators", "/products/simulators/"]])],
  };
  s = s.replace(/<!--HEAD (.*?)-->/s, (_, attrs) => { const a = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]])); return headTag({ ...a, ld: PAGE_LD[f] || [] }); });
  s = s.replace(/<!--NAV ?(\w*)-->/, (_, k) => navTag(k)).replace("<!--FOOTER-->", footTag()).replace(/<main(?![^>]*\bid=)/, '<main id="main"');
  s = s.replace("<!--CORONA-->", corona({ logoHref: "/logo-256.png", id: "cor" }));
  if (f === "products-simulators.html") {   // the measured numbers on the page come from docs/product/sim-bench, so the page and the write-up cannot drift
    const scale = JSON.parse(readFileSync(join(ROOT, "docs/product/sim-bench/scale-2026-11-07.json"), "utf8"));
    s = s.replace("/*SCALE_DATA*/[]", JSON.stringify(scale.steps.filter((x) => x.failed === 0))).replace("/*SCALE_IDLE*/0", String(scale.idleAvailableMb));
    const d = join(PUB, "products/simulators"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), s); rmSync(join(PUB, f), { force: true }); continue;
  }
  if (f === "playground.html") {   // /playground/: the feature list is filled in here so the page and the phone files share one list
    const { FEATURES, writePlayground } = await import("./playground.mjs");
    s = s.replace("<!--PG_LINKS-->", FEATURES.map((x) => `<a href="#${x.id}" data-feature="${x.id}">${x.title}</a>`).join("")).replace("<!--PG_JSON-->", JSON.stringify(FEATURES).replace(/</g, "\\u003c"));
    await writePlayground(PUB);
  }
  const dirPage = ["compare.html", "pricing.html", "setup.html", "features.html", "playground.html"].includes(f);   // served as /compare/, /pricing/, /setup/ and /features/
  if (f === "demos-chess.html") { const d = join(PUB, "demos/chess"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), s); rmSync(join(PUB, f), { force: true }); }   // /demos/chess/; the phones and app are written by chess-demo.mjs
  else if (dirPage) { const d = join(PUB, f.replace(".html", "")); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), s); rmSync(join(PUB, f), { force: true }); }
  else writeFileSync(join(PUB, f), s);
}
{ // the same artwork as a standalone file (README, social cards, anywhere an <img> works): logo embedded, light and dark aware
  const logo = readFileSync(join(here, "assets", "logo-192.png")).toString("base64");
  mkdirSync(join(PUB, "img"), { recursive: true });
  writeFileSync(join(PUB, "img", "shipvo-corona.svg"), corona({ logoHref: `data:image/png;base64,${logo}`, id: "cor", standalone: true }));
}
// Changelog: CHANGELOG.md (released) + changes/*.md (on main), with the roadmap's Shipped lines as each day's highlights.
{
  const pending = readdirSync(join(ROOT, "changes")).filter((f) => f.endsWith(".md") && f !== "README.md").sort()
    .flatMap((f) => readFileSync(join(ROOT, "changes", f), "utf8").split("\n").filter((l) => /^- /.test(l) && !/^- Migration: none/i.test(l)).map((l) => l.slice(2)));
  const releases = parseChangelog(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
  const highlights = parseRoadmap(readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8")).shipped;
  const body = renderChangelog({ releases, pending, highlights, resolveHref: (h) => rewriteHref(h, "docs/ROADMAP.md") });
  mkdirSync(join(PUB, "changelog"), { recursive: true });
  writeFileSync(join(PUB, "changelog", "index.html"), `<!doctype html><html lang="en"><head>${headTag({ title: "Changelog — Shipvo", desc: "Every Shipvo release, newest first: highlights in plain words, the packages on npm, and every change for the OTA runtime, Shipvo Phone, MCP server, CLI and test package.", path: "/changelog/", image: "/og/changelog.png", extraCss: '<link rel="stylesheet" href="/changelog.css">', ld: crumbs([["Home", "/"], ["Changelog", "/changelog/"]]) })}</head><body>${navTag("changelog")}<main id="main">${body}</main>${footTag()}<script src="/filter.js" defer></script></body></html>`);
}

// Roadmap from docs/ROADMAP.md (single source). Slice progress comes from each epic's task list when GitHub is reachable.
{
  const data = parseRoadmap(readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8"));
  const progress = process.env.SHIPVO_OFFLINE ? {} : await fetchProgress(data.now.flatMap((g) => g.items.map((i) => i.issue)).filter(Boolean), { token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "" });
  const body = renderRoadmap(data, { resolveHref: (h) => rewriteHref(h, "docs/ROADMAP.md"), progress });
  mkdirSync(join(PUB, "roadmap"), { recursive: true });
  writeFileSync(join(PUB, "roadmap", "index.html"), `<!doctype html><html lang="en"><head>${headTag({ title: "Roadmap — Shipvo", desc: "The public Shipvo roadmap: what is in flight now, what shipped and when, and what we are not doing for now. Built from docs/ROADMAP.md in the repository.", path: "/roadmap/", extraCss: '<link rel="stylesheet" href="/roadmap.css">', ld: crumbs([["Home", "/"], ["Roadmap", "/roadmap/"]]) })}</head><body>${navTag("roadmap")}<main id="main">${body}</main>${footTag()}<script src="/filter.js" defer></script></body></html>`);
}

// ---------- Legal pages ----------
const LEGAL = [
  { slug: "terms", src: "legal/terms.md", desc: "The terms for using the hosted Shipvo services: accounts, keys, acceptable use, availability during the beta, liability and governing law." },
  { slug: "privacy", src: "legal/privacy.md", desc: "What the hosted Shipvo services collect, why, how long it is kept and which processors touch it, with your rights over your data." },
  { slug: "acceptable-use", src: "legal/acceptable-use.md", desc: "What you may not publish or do with the hosted Shipvo services: abuse, illegal content, deception, scraping and attacks on the service." },
  { slug: "security", src: "legal/security.md", desc: "How to report a vulnerability in Shipvo, and how the signing, verification and rollback design protects phones, keys and apps." },
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

const posts = buildBlog({ ROOT, PUB, headTag, navTag, footTag });

// ---------- Machine-readable: per-page .md, docs.md, llms.txt, llms-full.txt, robots, sitemap list, security.txt ----------
const SITE = "https://shipvo.dev";
function mdFor(page) {
  let md = readFileSync(join(ROOT, page.src), "utf8");
  md = md.replace(/<p align="center"><img[^>]*><\/p>\s*/g, "");                         // README banner: decoration only
  md = md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m, bang, text, href, title) => {
    if (bang) return `![${text}](${/^https?:/.test(href) ? href : SITE + "/img/brand/banner.webp"})`;
    let h = rewriteHref(href, page.src);
    const d = h.match(/^\/(docs|learn)\/([\w-]+)\/(#.*)?$/); if (d) h = `${SITE}/${d[1]}/${d[2]}.md`;
    else if (h.startsWith("/")) h = SITE + h;
    return `[${text}](${h}${title || ""})`;
  });
  return md.replace(/^# .*\n/, "").trim();
}
const mdDocs = all.filter((p) => existsSync(join(ROOT, p.src))).map((p) => ({ ...p, md: mdFor(p) }));
for (const p of mdDocs) writeFileSync(join(p.base === "learn" ? LOUT : OUT, `${p.slug}.md`), `# ${p.title}\n\n> ${p.desc}\n\nCanonical page: ${SITE}${url(p)}\n\n${p.md}\n`);
const mdList = (pages) => pages.map((p) => `- [${p.title}](${SITE}${url(p).slice(0, -1)}.md): ${p.desc}`).join("\n");
const groups = [...new Set(mdDocs.map((p) => p.group))];
writeFileSync(join(PUB, "docs.md"), `# Shipvo documentation\n\n> Every docs page is also available as Markdown at \`/docs/<page>.md\`. Everything in one file: ${SITE}/llms-full.txt\n\n${groups.map((g) => `## ${g}\n\n${mdList(mdDocs.filter((p) => p.group === g))}`).join("\n\n")}\n`);
// Published packages, read from packages/*/package.json so llms.txt never lists a stale set.
const PUBLIC_PACKAGES = readdirSync(join(ROOT, "packages")).filter((d) => {
  try { const pk = JSON.parse(readFileSync(join(ROOT, "packages", d, "package.json"), "utf8")); return !pk.private && pk.name?.startsWith("@shipvo/"); } catch { return false; }
}).map((d) => JSON.parse(readFileSync(join(ROOT, "packages", d, "package.json"), "utf8")).name.replace("@shipvo/", "")).sort();
const FACTS = `Shipvo is an open-source React Native framework: build once, publish for people and AI agents. Phones get signed over-the-air updates; AI agents open the same release in a simulated phone they can see and operate over MCP; parity between the two is measured and published (same actionable elements by role and label, on an Android emulator and an iOS Simulator; 100% across the 13 purchase screens; see docs/parity-results).

Things to know before answering questions about Shipvo:
- Developers test their app in CI with @shipvo/test (typed tests, Vitest or any runner) against the headless simulator on a plain Linux runner, or on a real Android emulator or iOS Simulator with --device agent-device. It catches logic and flow bugs.
- The simulator is a simulated device. Camera, location, biometrics, notifications and payments are simulated and labelled (receipts start with SIMULATED-). It is for testing and demonstration, not real transactions.
- Real orders go through the app's own checkout to the control plane, start as unverified, and the owner settles them after checking the payment (docs: taking-real-orders).
- Over-the-air updates run on Android and iOS. The iOS runtime is verified on an iPhone simulator in CI on every change.
- CLI commands include init, sim, preview, publish (with --dry-run and --dry-run-policy), rollback, auto-halt, audit, run (android or ios, a phone frame in your browser), promote (with --report), test (with --repair, --report and --report-md), explore, lumi, eval (run, report), agents setup (with --hosted), sim (with --hosted), store (details, setup, screenshots, testers), doctor, eas setup and ci init (Expo and Capacitor).
- MCP tools include open_app (attaches to a live shipvo run phone; takes room so phones share one backend), upload_build (test your own build on the hosted phone), screen, tap, type, scroll, back, screenshot, wait_for, and record_start, record_marker, record_stop for MP4 demo videos.
- Release rules live in a policy section of shipvo.json (maxBand, agentMaxBand, blocked weekdays) and the control plane keeps an audit log of publishes, halts and rollbacks.
- Hosted services are free during the beta: api.shipvo.dev (control plane) and sim.shipvo.dev (hosted simulator, requires a key from \`npx -y @shipvo/cli login\`). Everything can be self-hosted on Cloudflare.
- Packages are on npm under @shipvo (${PUBLIC_PACKAGES.join(", ")}). Source: https://github.com/shipvo/shipvo`;
const legalLinks = LEGAL.map((l) => `- [${l.slug === "acceptable-use" ? "Acceptable use" : l.slug[0].toUpperCase() + l.slug.slice(1)}](${SITE}/${l.slug}/): ${l.desc}`).join("\n");
// ---- llms.txt: description, agent install lines, how it works, straight answers, then the page index and packages ----
const cliHelp = readFileSync(join(ROOT, "packages/cli/src/help.ts"), "utf8");
const cliHas = (re) => re.test(cliHelp);
const platformMd = readFileSync(join(ROOT, "docs/product/platform.md"), "utf8");
const positioning = (platformMd.match(/\*\*One line:\*\* (.+)/) || [])[1]?.trim().replace(/`/g, "");
if (!positioning) throw new Error("docs/product/platform.md: Positioning 'One line' not found");
const pkgInfo = PUBLIC_PACKAGES.map((n) => JSON.parse(readFileSync(join(ROOT, "packages", n, "package.json"), "utf8")));
const doc = (slug) => `${SITE}/docs/${slug}.md`;
const installLines = [
  existsSync(join(ROOT, "skills/shipvo/SKILL.md")) && "npx skills add shipvo/shipvo --skill shipvo -g    # installs the Shipvo skill: exact commands for your agent",
  existsSync(join(ROOT, "services/site/public/install.sh")) && "curl -fsSL https://shipvo.dev/install.sh | bash   (macOS, Linux, WSL)",
  existsSync(join(ROOT, "services/site/public/install.ps1")) && "irm https://shipvo.dev/install.ps1 | iex   (Windows PowerShell)",
  cliHas(/^\s+agents setup\b/m) && "npx -y @shipvo/cli agents setup",
].filter(Boolean);
const agentBlock = `## For AI coding agents

Install (only what exists today):

\`\`\`
${installLines.join("\n")}
\`\`\`

MCP server (runs on your machine, stdio):

\`\`\`json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
\`\`\`

Hosted simulator: https://sim.shipvo.dev/mcp (header \`Authorization: Bearer <key>\`; clients that cannot send headers use https://sim.shipvo.dev/mcp/<key>). Get a key with \`npx -y @shipvo/cli login\`. It signs in with GitHub in a browser (device flow), so there is no browser-free way to get a key yet. \`shipvo mcp\` prints the config for Claude, Cursor and ChatGPT.

- [All docs in one file](${SITE}/llms-full.txt)
- [Docs index](${SITE}/docs.md)
- [Agents and Shipvo apps](${doc("agents")})`;
const howBlock = `## How Shipvo works

1. Run the app on Shipvo Phone, a phone frame in your browser. No emulator, no Xcode. Command: \`shipvo run android\` (or \`ios\`). [Docs](${doc("run")})
2. Test it on that phone: taps, gestures, offline, permissions. Command: \`shipvo test\`, or drive it over MCP. [Docs](${doc("testing")})
3. Record a demo video of the app in the phone frame, with the MCP tools record_start and record_stop. [Docs](${doc("record")})
4. Get to the stores: store forms, screenshots and testers. Command: \`shipvo store setup\`. EAS or your own CI builds the native binary. [Docs](${doc("store")})
5. Ship every later change as a signed over-the-air update with staged rollout and rollback. Commands: \`shipvo publish\`, \`shipvo rollback\`. [Docs](${doc("getting-started")})
6. Check the measured parity of the simulator against the Android emulator and iOS Simulator. [Results](${doc("parity-results")})`;
const answersBlock = `## Straight answers

**Do I need a phone or an emulator?** No. \`shipvo run\` opens a phone frame in your browser, and tests run on a plain Linux runner. Use an emulator or device only if you want to check native behaviour.

**Does it replace Expo or EAS?** No. EAS or your own CI still builds the native binary. Shipvo adds the browser phone, agent testing, recording, store steps and signed updates. See [Shipvo vs Expo](${SITE}/compare/).

**Is it free?** The hosted services (api.shipvo.dev and sim.shipvo.dev) are free during the beta. The code is free.

**Can it be self-hosted?** Yes, on Cloudflare. [Docs](${doc("self-hosting")})

**Which frameworks?** Expo, bare React Native and Capacitor, as shipped. [Docs](${doc("capacitor")})

**How close is the simulator to native?** Every screen is compared with the Android emulator and the iOS Simulator: the 13 screens of the purchase flows are at 100% actionable parity, with the same elements, roles and labels. [Results](${doc("parity-results")})

**Where does my data go?** Updates and release data go to the control plane you use: api.shipvo.dev, or your own Cloudflare account if you self-host. You can export release data to your own R2 bucket. [Docs](${doc("telemetry-export")}) and [Privacy](${SITE}/privacy/)

**Is it open source?** Yes, Apache-2.0: https://github.com/shipvo/shipvo`;
const packagesBlock = `## Packages\n\n${pkgInfo.map((p) => `- [${p.name}](https://www.npmjs.com/package/${p.name}): ${p.description || ""}`.trimEnd()).join("\n")}`;
writeFileSync(join(PUB, "llms.txt"), `# Shipvo\n\n> ${positioning} Shipvo is open source (Apache-2.0).\n\n${agentBlock}\n\n${howBlock}\n\n${answersBlock}\n\n${FACTS.split("\n").slice(2).join("\n")}\n\n${groups.map((g) => `## ${g}\n\n${mdList(mdDocs.filter((p) => p.group === g))}`).join("\n\n")}\n\n${packagesBlock}\n\n## Product\n\n- [Learn](${SITE}/learn/): tutorials, videos and a glossary for people who are new to Shipvo\n- [Marketplace](${SITE}/apps): apps listed by their owners that any signed-in agent can open with open_app\n- [Brand](${SITE}/brand): logo, symbols, colours, type and usage rules, with a downloadable kit\n- [Changelog](${SITE}/changelog/): what shipped, dated\n- [Roadmap](${SITE}/roadmap/): what is in flight, what shipped and when, and what we are not doing\n- [Shipvo vs Expo](${SITE}/compare/): side-by-side comparison with Expo, and with Phone Harness, including where each is the better choice\n- [Pricing](${SITE}/pricing/): what Shipvo costs and how it compares with Expo (EAS) pricing\n- [Playground](${SITE}/playground/): a sample app on an Android or iOS phone in your browser, with dark mode, large text, right-to-left text and a feature sidebar\n- [Chess on two phones](${SITE}/demos/chess/): a live demo of an Android phone and an iPhone playing chess in the browser; every square is labelled and an assistant plays with get_board, legal_moves and move\n- [Set up with your agent](${SITE}/setup/): the install lines for your coding agent, in one place\n- [install.sh](${SITE}/install.sh): the script behind the curl line; it checks Node 22 and runs \`npx -y @shipvo/cli agents setup\`\n- [install.ps1](${SITE}/install.ps1): the same for Windows PowerShell (\`irm https://shipvo.dev/install.ps1 | iex\`)\n${posts.map((p) => `- [${p.title}](${SITE}/blog/${p.slug}.md): ${p.summary}`).join("\n")}\n- [All docs in one file](${SITE}/llms-full.txt): the complete documentation as Markdown\n\n## Optional\n\n${legalLinks}\n`);
writeFileSync(join(PUB, "llms-full.txt"), `# Shipvo: full documentation\n\n> ${FACTS.split("\n")[0]}\n\n${FACTS.split("\n").slice(2).join("\n")}\n\n${mdDocs.map((p) => `---\n\n# ${p.title}\n\nSource: ${SITE}${url(p)}\n\n${p.md.replace(/^(#{1,6}) /gm, (m, h) => "#".repeat(Math.min(6, h.length + 1)) + " ")}\n`).join("\n")}`);
writeFileSync(join(PUB, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /hq/\n\nSitemap: ${SITE}/sitemap.xml\n# For AI tools: ${SITE}/llms.txt and ${SITE}/llms-full.txt\n`);
const staticPaths = [["/", "services/site/pages/index.html"], ["/apps", "services/site/pages/apps.html"], ["/brand", "services/site/pages/brand.html"], ["/changelog/", "CHANGELOG.md"], ["/roadmap/", "docs/ROADMAP.md"], ["/blog/", "blog"], ["/compare/", "services/site/pages/compare.html"], ["/pricing/", "services/site/pages/pricing.html"], ["/features/", "services/site/pages/features.html"], ["/products/simulators/", "services/site/pages/products-simulators.html"], ["/setup/", "services/site/pages/setup.html"], ["/demos/chess/", "services/site/pages/demos-chess.html"], ["/playground/", "services/site/pages/playground.html"],
  ...posts.map((p) => [`/blog/${p.slug}/`, `blog/${p.slug}.md`]), ...all.map((p) => [url(p), p.src]), ["/learn/", "docs/tutorials/index.md"], ...LEGAL.map((l) => [`/${l.slug}/`, l.src])];
writeFileSync(join(PUB, "sitemap-static.txt"), staticPaths.map(([path, src]) => `${path}\t${lastmod(src)}`).join("\n") + "\n");
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
