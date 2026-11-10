// Forwards /vault-ui/* from the phone's Settings app to the four vault key routes on the control plane.
// The owner token stays in this process. Only loopback hosts and same-origin pages are served.
const SEG = "[A-Za-z0-9._-]{1,64}";
const ROUTES = [
  { method: "GET", re: /^\/vault-ui\/keys$/, to: (m, q) => `/vault/keys?app=${encodeURIComponent(q.get("app") ?? "")}`, needsApp: true },
  { method: "POST", re: new RegExp(`^/vault-ui/keys/(${SEG})/(${SEG})/rotate$`), to: (m) => `/vault/keys/${m[1]}/${m[2]}/rotate` },
  { method: "DELETE", re: new RegExp(`^/vault-ui/keys/(${SEG})/(${SEG})$`), to: (m) => `/vault/keys/${m[1]}/${m[2]}` },
  { method: "GET", re: new RegExp(`^/vault-ui/keys/(${SEG})/(${SEG})/uses$`), to: (m) => `/vault/keys/${m[1]}/${m[2]}/uses` },
];
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export const isVaultUiPath = (pathname) => pathname === "/vault-ui" || pathname.startsWith("/vault-ui/");

/** Returns handle(req, res, url). Call it for paths where isVaultUiPath is true. */
export function createSecretsForward({ control, token, fetchImpl = fetch }) {
  return async function handle(req, res, url) {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
    const host = String(req.headers.host ?? "");
    if (!LOOPBACK.test(host)) return send(403, { error: "forbidden_host" });
    const origin = req.headers.origin, site = req.headers["sec-fetch-site"];
    if ((origin !== undefined && origin !== `http://${host}`) || (site !== undefined && site !== "same-origin" && site !== "none")) return send(403, { error: "cross_origin" });
    const byPath = ROUTES.filter((r) => r.re.test(url.pathname));
    if (!byPath.length) return send(404, { error: "not_found" });
    const route = byPath.find((r) => r.method === req.method);
    if (!route) { res.setHeader?.("allow", byPath.map((r) => r.method).join(", ")); return send(405, { error: "method_not_allowed" }); }
    if (route.needsApp && !/^[A-Za-z0-9._-]{1,64}$/.test(url.searchParams.get("app") ?? "")) return send(400, { error: "bad_request" });
    if (!token) return send(503, { error: "no_credentials" });
    let up;
    try {
      up = await fetchImpl(`${control}${route.to(url.pathname.match(route.re), url.searchParams)}`, { method: route.method, headers: { authorization: `Bearer ${token}` } });
    } catch { return send(502, { error: "upstream_unreachable" }); }
    const text = await up.text();
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
    res.end(text.split(token).join(""));
  };
}
