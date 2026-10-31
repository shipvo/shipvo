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
    if (/^\/apps\/[a-z0-9-]+\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/app", url).toString(), req));
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    h.set("x-content-type-options", "nosniff"); h.set("referrer-policy", "strict-origin-when-cross-origin");
    return new Response(res.body, { status: res.status, headers: h });
  },
};
