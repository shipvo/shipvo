// Session network layer for the app page: mock rules and network profiles share ONE route,
// so the order of set_network_mocks and set_network_profile does not matter.
import { applyProfile, getProfile } from "./network-profiles.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findRule = (s, req) => (s.mocks ?? []).find((m) => (!m.method || m.method === req.method()) && m.match(req.url()));
const CORS = { "access-control-allow-origin": "*" };

// Register the single route once per session. It reads s.mocks and s.netFetch on every request.
export async function ensureNetRoute(s, page) {
  if (s.netRoute) return;
  s.netRoute = true;
  await page.route("**/*", async (route) => {
    const req = route.request(); const type = req.resourceType();
    if (type !== "fetch" && type !== "xhr") return route.fallback();
    const rule = findRule(s, req);
    if (!s.netFetch) {
      if (!rule) return route.fallback();
      if (rule.delayMs) await sleep(rule.delayMs);
      // The app page may come from another origin, so the stub must pass the browser's CORS check.
      return route.fulfill({ status: rule.status, body: rule.body, headers: { ...CORS, ...rule.headers } }).catch(() => {});
    }
    try {
      const res = await s.netFetch({ route, rule });
      await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { ...CORS, ...Object.fromEntries(res.headers) } }).catch(() => {});
    } catch { await route.abort("internetdisconnected").catch(() => {}); }
  });
}

// Set the profile on the session. Does not touch the device state; the caller does that.
export function installProfile(s, name, seed) {
  const profile = getProfile(name ?? "online");
  s.netProfile = profile.name;
  s.netFetch = profile.name === "online" ? null : applyProfile(async ({ route, rule }) => {
    if (rule) { if (rule.delayMs) await sleep(rule.delayMs); return new Response(rule.body, { status: rule.status, headers: rule.headers }); }
    const r = await route.fetch();
    return new Response(r.status() === 204 || r.status() === 304 ? null : await r.body(), { status: r.status(), headers: r.headers() });
  }, profile, { seed: Number.isInteger(seed) ? seed : 1 });
  return profile;
}

export function clearProfile(s) { s.netProfile = "online"; s.netFetch = null; }
