// shipvo.dev: static site + the marketplace. /apps/<id> is the same page as /apps with the id in the path;
// the directory itself comes from the control plane (api.shipvo.dev/apps/public) and is proxied here so the
// pages stay same-origin.
type Env = { ASSETS: Fetcher; API: string };
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname === "www.shipvo.dev") return Response.redirect(`https://shipvo.dev${url.pathname}${url.search}`, 301);
    if (url.pathname.startsWith("/api/apps")) {
      const r = await fetch(`${env.API}/apps/public${url.pathname.slice("/api/apps".length)}${url.search}`, { cf: { cacheTtl: 30 } } as any);
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
    }
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
    h.set("x-content-type-options", "nosniff"); h.set("referrer-policy", "strict-origin-when-cross-origin");
    return new Response(res.body, { status: res.status, headers: h });
  },
};
