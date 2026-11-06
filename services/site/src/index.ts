// shipvo.dev: static site + the marketplace. /apps/<id> is the same page as /apps with the id in the path;
// the directory itself comes from the control plane (api.shipvo.dev/apps/public) and is proxied here so the
// pages stay same-origin.
type Env = { ASSETS: Fetcher; API: string; MEDIA?: R2Bucket };

// Videos and other large media live in R2 (bucket shipvo-media), never in git. Keys are content-addressed
// (videos/<slug>-<sha8>.mp4), so they are immutable and cached for a year. Range requests let players seek.
async function media(req: Request, env: Env, key: string): Promise<Response> {
  if (!env.MEDIA || !/^[a-z0-9][a-z0-9/_.-]*$/.test(key) || key.includes("..")) return new Response("Not found", { status: 404 });
  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const size = head.size;
  const h = new Headers();
  head.writeHttpMetadata(h);
  h.set("etag", head.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=31536000, immutable");
  if (!h.has("content-type")) h.set("content-type", key.endsWith(".mp4") ? "video/mp4" : "application/octet-stream");
  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    h.set("content-range", `bytes ${start}-${end}/${size}`);
    h.set("content-length", String(end - start + 1));
    if (req.method === "HEAD") return new Response(null, { status: 206, headers: h });
    const part = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
    return new Response(part?.body ?? null, { status: 206, headers: h });
  }
  h.set("content-length", String(size));
  if (req.method === "HEAD") return new Response(null, { status: 200, headers: h });
  const obj = await env.MEDIA.get(key);
  return new Response(obj?.body ?? null, { status: 200, headers: h });
}
// Learn pages used to live under /docs/. Old links keep working with a permanent redirect.
export const LEARN_REDIRECTS: Record<string, string> = {
  "/docs/learn": "/learn/",
  "/docs/first-app": "/learn/first-app/",
  "/docs/your-own-shop": "/learn/your-own-shop/",
  "/docs/videos": "/learn/videos/",
  "/docs/glossary": "/learn/glossary/",
  "/docs/learn.md": "/learn/",
  "/docs/first-app.md": "/learn/first-app.md",
  "/docs/your-own-shop.md": "/learn/your-own-shop.md",
  "/docs/videos.md": "/learn/videos.md",
  "/docs/glossary.md": "/learn/glossary.md",
};
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname === "www.shipvo.dev") return Response.redirect(`https://shipvo.dev${url.pathname}${url.search}`, 301);
    if (url.pathname.startsWith("/api/apps")) {
      const r = await fetch(`${env.API}/apps/public${url.pathname.slice("/api/apps".length)}${url.search}`, { cf: { cacheTtl: 30 } } as any);
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
    }
    if (url.pathname === "/sitemap.xml") {
      // Static pages come from the build; listed apps come from the live directory, so a new listing is crawlable at once.
      const [pages, dir] = await Promise.all([
        env.ASSETS.fetch(new Request(new URL("/sitemap-static.txt", url).toString())).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
        fetch(`${env.API}/apps/public`, { cf: { cacheTtl: 300 } } as any).then((r) => (r.ok ? r.json() : { apps: [] })).catch(() => ({ apps: [] })) as Promise<any>,
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const rows = [
        ...pages.split("\n").filter(Boolean).map((l) => { const [p, d] = l.split("\t"); return `<url><loc>https://shipvo.dev${esc(p)}</loc><lastmod>${/^\d{4}-\d\d-\d\d$/.test(d ?? "") ? d : today}</lastmod></url>`; }),
        ...(dir.apps ?? []).filter((a: any) => /^[a-z0-9-]+$/.test(a.app_id)).map((a: any) => `<url><loc>https://shipvo.dev/apps/${a.app_id}</loc>${a.published_at ? `<lastmod>${String(a.published_at).slice(0, 10)}</lastmod>` : ""}</url>`),
      ];
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (url.pathname.startsWith("/media/")) return media(req, env, decodeURIComponent(url.pathname.slice("/media/".length)));
    // Shipvo HQ: the agent team's live status, written to R2 by the merge bot's workflow after every pass.
    if (url.pathname === "/hq/status.json") {
      const obj = env.MEDIA ? await env.MEDIA.get("hq/status.json") : null;
      if (!obj) return new Response(JSON.stringify({ error: "no snapshot yet" }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(obj.body, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    if (url.pathname.replace(/\/+$/, "") === "/testers") return Response.redirect("https://groups.google.com/g/shipvo-testers", 302);
    if (url.pathname === "/hq") return Response.redirect("https://shipvo.dev/hq/", 301);
    if (url.pathname === "/.well-known/security.txt") return env.ASSETS.fetch(new Request(new URL("/security.txt", url).toString(), req));
    const moved = LEARN_REDIRECTS[url.pathname.replace(/\/+$/, "")];
    if (moved) return Response.redirect(`https://shipvo.dev${moved}${url.search}`, 301);
    if (url.pathname === "/docs") return Response.redirect("https://shipvo.dev/docs/overview/", 301);
    const m = url.pathname.match(/^\/apps\/([a-z0-9-]+)\/?$/);
    if (m) {
      // Same page for every app, but link previews (Slack, X, iMessage) never run scripts: put the app's own name,
      // tagline and image into the HTML so a shared link looks like that app, not like a generic page.
      const page = await env.ASSETS.fetch(new Request(new URL("/app", url).toString(), req));
      const r = await fetch(`${env.API}/apps/public/${m[1]}`, { cf: { cacheTtl: 60 } } as any).catch(() => null);
      if (!r || !r.ok) return page;
      const a: any = await r.json();
      const title = `${a.name} — Shipvo`, desc = String(a.tagline || a.description || "A Shipvo app any signed-in agent can open.").slice(0, 200);
      const img = a.screenshots?.[0] || a.icon_url || "https://shipvo.dev/og.png", canon = `https://shipvo.dev/apps/${m[1]}`;
      const meta = (sel: string, v: string, attr = "content") => ({ element: (e: Element) => { e.setAttribute(attr, v); } });
      return new HTMLRewriter()
        .on("title", { element(e) { e.setInnerContent(title); } })
        .on('meta[name="description"]', meta("", desc))
        .on('meta[property="og:title"]', meta("", title))
        .on('meta[property="og:description"]', meta("", desc))
        .on('meta[property="og:url"]', meta("", canon))
        .on('meta[property="og:image"]', meta("", img))
        .on('link[rel="canonical"]', meta("", canon, "href"))
        .transform(page);
    }
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    if (url.pathname.endsWith(".md")) h.set("content-type", "text/markdown; charset=utf-8");
    else if (url.pathname === "/install.sh") { h.set("content-type", "text/x-shellscript; charset=utf-8"); h.set("cache-control", "public, max-age=300"); }
    else if (url.pathname.endsWith(".txt")) h.set("content-type", "text/plain; charset=utf-8");
    h.set("x-content-type-options", "nosniff"); h.set("referrer-policy", "strict-origin-when-cross-origin");
    return new Response(res.body, { status: res.status, headers: h });
  },
};
