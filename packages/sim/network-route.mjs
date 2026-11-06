// One page route for the app's fetch/XHR. It serves both mock rules (`s.mocks`) and the network profile (`s.netFetch`),
// so the order of set_network_mocks and set_network_profile does not matter.
import { applyProfile, getProfile } from "./network-profiles.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findRule = (s, req) => (s.mocks ?? []).find((m) => (!m.method || m.method === req.method()) && m.match(req.url()));
const CORS = { "access-control-allow-origin": "*" };

export async function installNetworkRoute(s, page) {
  if (s.netRoute) return;
  s.netRoute = true;
  await page.route("**/*", async (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (type !== "fetch" && type !== "xhr") return route.fallback();
    const rule = findRule(s, req);
    if (!s.netFetch) {
      if (!rule) return route.fallback();
      if (rule.delayMs) await sleep(rule.delayMs);
      // The app page may come from another origin, so the stub must pass the browser's CORS check.
      return route.fulfill({ status: rule.status, body: rule.body, headers: { ...CORS, ...rule.headers } }).catch(() => {});
    }
    try {
      // Streaming responses are buffered here: applyProfile needs the whole body to count bytes.
      const res = await s.netFetch({ route, rule });
      await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { ...CORS, ...Object.fromEntries(res.headers) } }).catch(() => {});
    } catch { await route.abort("internetdisconnected").catch(() => {}); }
  });
}

// The profile wraps the real network and the mock rules alike: a mocked response is also slowed and can also fail.
export async function setNetworkProfile(s, page, name, seed) {
  const profile = getProfile(name ?? "online"); // throws NetworkProfileError with code unknown_profile
  s.netProfile = profile.name;
  s.netFetch = profile.name === "online" ? null : applyProfile(async ({ route, rule }) => {
    if (rule) {
      if (rule.delayMs) await sleep(rule.delayMs);
      return new Response(rule.body, { status: rule.status, headers: rule.headers });
    }
    const r = await route.fetch();
    return new Response(r.status() === 204 || r.status() === 304 ? null : await r.body(), { status: r.status(), headers: r.headers() });
  }, profile, { seed: Number.isInteger(seed) ? seed : 1 });
  await installNetworkRoute(s, page);
  await page.evaluate((n) => globalThis.__pnDevice?.set({ networkProfile: n }), profile.name);
  return { profile: profile.name, ...numbers(profile) };
}

// Used by device_reset: the device goes back to "online", so the fetch layer must too.
export function clearNetworkProfile(s) { s.netProfile = "online"; s.netFetch = null; }

const numbers = ({ latencyMs, downKbps, failureRate }) => ({ latencyMs, downKbps: Number.isFinite(downKbps) ? downKbps : null, failureRate, simulated: true });
