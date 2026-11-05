// Live phone embed (issue #420). Turns
//   <div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="..." data-fallback="/x.png"></div>
// into a phone frame around an iframe of https://api.shipvo.dev/w/<app>/r<n>/<path>.
// A fixed release gets its src at build time. "latest" gets no src: public/phone.js reads releases.json once and sets it.
export const PHONE_API = "https://api.shipvo.dev/w";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function parseAttrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/\s(data-[\w-]+)(?:\s*=\s*"([^"]*)")?/g)) out[m[1]] = unesc(m[2] ?? "");
  return out;
}

// The URL of a fixed release, or null when the inputs are not safe to put in a src.
export function phoneSrc({ app, release, path = "/", api = PHONE_API }) {
  if (!/^[\w-]+$/.test(app || "") || !/^\d+$/.test(String(release))) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || /[\s"'<>\\]/.test(path)) return null;
  return `${api.replace(/\/$/, "")}/${app}/r${release}${path}`;
}

export function renderPhone(a) {
  const app = a["data-app"] || "tide";
  const release = a["data-release"] || "latest";
  const path = a["data-path"] || "/";
  const api = a["data-api"] || PHONE_API;
  const caption = a["data-caption"] || "Try the app";
  const fallback = a["data-fallback"] || "";
  const latest = release === "latest";
  const src = latest ? (phoneSrc({ app, release: 0, path, api }) ? "" : null) : phoneSrc({ app, release, path, api });
  const ok = src !== null;
  const title = `Live phone: ${caption}`;
  const img = fallback ? `<img src="${esc(fallback)}" alt="Screenshot of the app" loading="lazy">` : "";
  const msg = `<p class="phone-msg" role="status" ${ok ? "hidden" : ""}>The live phone could not load. ${fallback ? "Here is a screenshot instead." : ""}</p>${fallback ? `<div class="phone-shot" ${ok ? "hidden" : ""}>${img}</div>` : ""}`;
  return `<figure class="phone-embed${ok ? "" : " phone-failed"}" data-phone data-app="${esc(app)}" data-release="${esc(release)}" data-path="${esc(path)}" data-api="${esc(api)}">
<div class="phone-box"><div class="phone-frame">${ok ? `<iframe title="${esc(title)}" width="390" height="844" loading="lazy" ${src ? `src="${esc(src)}"` : ""}></iframe>` : ""}</div></div>
${msg}
<figcaption>${esc(caption)}</figcaption>
<p class="phone-links"><a href="#" data-phone-reload>Reload</a> <a href="${src ? esc(src) : "#"}" data-phone-full target="_blank" rel="noopener">Open full screen<span class="sr-only"> (new tab)</span></a></p>
</figure>`;
}

// Replace every embed div in rendered HTML.
export function transformPhones(html) {
  return html.replace(/<div\s[^>]*\bdata-shipvo-phone\b[^>]*>\s*<\/div>/g, (tag) => renderPhone(parseAttrs(tag)));
}
