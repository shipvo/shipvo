// The site's shared chrome: head, nav with product and solutions menus, footer. Stamped into every page by build.mjs.
export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">`;

export const head = ({ title, desc, path = "/", extraCss = "" }) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="https://shipvo.dev${path}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="https://shipvo.dev${path}"><meta property="og:type" content="website"><meta property="og:image" content="https://shipvo.dev/og.png">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#090D16">
<link rel="icon" href="/favicon.png" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
${FONTS}
<link rel="stylesheet" href="/site.css">${extraCss}`;

const PRODUCT = [
  ["Publish", "/docs/getting-started/#5-publish-over-the-air", "Signed OTA updates, cohorts, rollback"],
  ["Simulate", "/docs/agents/", "A phone agents can see and operate over MCP"],
  ["Verify", "/docs/parity-results/", "Simulator vs device parity, measured nightly"],
  ["Marketplace", "/apps", "Apps any signed-in agent can open"],
  ["CLI", "/docs/cli/", "init · sim · login · app · publish · rollback"],
  ["MCP server", "/docs/mcp/", "Local over stdio, hosted with a key"],
  ["Device API", "/docs/device-api/", "Camera, location, biometrics, payments, notifications"],
  ["Runtime", "/docs/runtime/", "The OTA runtime and Expo plugin"],
];
const SOLUTIONS = [
  ["Test with the assistant you use", "/#how", "Claude, ChatGPT or Cursor drives your app end to end, no emulator"],
  ["Ship updates without the store", "/docs/getting-started/", "Push to main; phones have it in seconds"],
  ["Make your app agent-ready", "/docs/agents/#listing-your-app-for-every-agent", "List it so any agent can open it"],
  ["Self-host everything", "/docs/self-hosting/", "Your Cloudflare account, your keys, ten minutes"],
];
const menu = (items) => `<div class="menu"><div class="menu-grid">${items.map(([t, h, d]) => `<a href="${h}"><b>${t}</b><span>${d}</span></a>`).join("")}</div></div>`;

export const nav = (active = "") => `<header class="nav"><div class="wrap">
  <a class="logo" href="/" aria-label="Shipvo home"><img src="/logo-256.png" alt="" width="28" height="28">Shipvo</a>
  <nav class="primary" aria-label="Primary">
    <a href="/docs/" class="${active === "docs" ? "on" : ""}">Docs</a>
    <div class="has-menu"><button type="button" aria-expanded="false" aria-haspopup="true">Product<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${menu(PRODUCT)}</div>
    <div class="has-menu"><button type="button" aria-expanded="false" aria-haspopup="true">Solutions<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${menu(SOLUTIONS)}</div>
    <a href="/apps" class="${active === "apps" ? "on" : ""}">Apps</a>
    <a href="/changelog/" class="${active === "changelog" ? "on" : ""}">Changelog</a>
  </nav>
  <div class="nav-right">
    <a class="gh" href="https://github.com/shipvo/shipvo" rel="noopener" aria-label="Shipvo on GitHub"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5A11.5 11.5 0 0 0 .5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.1c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/></svg><span data-stars>Star</span></a>
    <a class="btn primary" href="/docs/getting-started/">Get started</a>
  </div>
  <button class="burger" type="button" aria-label="Menu" aria-expanded="false"><span></span></button>
</div>
<div class="mobile-menu" hidden>
  <a href="/docs/">Docs</a><a href="/apps">Apps</a><a href="/changelog/">Changelog</a>
  <div class="mm-title">Product</div>${PRODUCT.map(([t, h]) => `<a href="${h}">${t}</a>`).join("")}
  <div class="mm-title">Solutions</div>${SOLUTIONS.map(([t, h]) => `<a href="${h}">${t}</a>`).join("")}
  <a href="https://github.com/shipvo/shipvo" rel="noopener">GitHub</a>
</div></header>`;

export const footer = () => `<footer class="foot"><div class="wrap">
  <div class="foot-grid">
    <div class="foot-brand"><a class="logo" href="/"><img src="/logo-256.png" alt="" width="28" height="28">Shipvo</a><p>Build once. Publish for people and AI agents.</p><p class="mono small">MIT · made in Douala</p><div class="status" data-status><span class="dot"></span><span>checking services…</span></div></div>
    <div><div class="foot-title">Product</div><a href="/docs/getting-started/#5-publish-over-the-air">Publish</a><a href="/docs/agents/">Simulate</a><a href="/docs/parity-results/">Verify</a><a href="/apps">Marketplace</a><a href="https://www.npmjs.com/org/shipvo" rel="noopener">npm packages</a></div>
    <div><div class="foot-title">Docs</div><a href="/docs/getting-started/">Build your first app</a><a href="/docs/cli/">CLI reference</a><a href="/docs/mcp/">MCP server</a><a href="/docs/device-api/">Device API</a><a href="/docs/self-hosting/">Self-hosting</a></div>
    <div><div class="foot-title">Proof</div><a href="/docs/parity-results/">Parity results</a><a href="/docs/spike-results/">OTA on a 2 GB phone</a><a href="/docs/agent-gate-results/">Agent gate</a><a href="/changelog/">Changelog</a></div>
    <div><div class="foot-title">Company</div><a href="https://github.com/shipvo/shipvo" rel="noopener">GitHub</a><a href="https://x.com/HansCadx" rel="noopener">X</a><a href="mailto:hans@pipilot.dev">Contact</a><a href="https://github.com/shipvo/shipvo/blob/main/LICENSE" rel="noopener">License</a></div>
  </div>
  <div class="foot-bottom"><span>© ${new Date().getFullYear()} Shipvo. Not affiliated with Expo, Apple, Google, OpenAI or Anthropic.</span><span class="mono small">api.shipvo.dev · sim.shipvo.dev</span></div>
</div></footer>
<script src="/shell.js" defer></script>`;
