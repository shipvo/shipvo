// Network profiles for the simulator.
// Every number below is a simulation setting, not a measurement of a real network.
// `low-end-4g` takes its latency from docs/spike-results.md, section "Device" ("Network: 4G / Wi-Fi, Douala"):
// that section names the network but gives no round-trip time, so the 300 ms here is a setting we chose for it.
export const PROFILES = Object.freeze({
  online: { latencyMs: 0, downKbps: Infinity, failureRate: 0 },
  offline: { latencyMs: 0, downKbps: 0, failureRate: 1 },
  "2g": { latencyMs: 800, downKbps: 50, failureRate: 0.02 },
  "3g": { latencyMs: 300, downKbps: 750, failureRate: 0.01 },
  "slow-4g": { latencyMs: 150, downKbps: 1600, failureRate: 0 },
  spotty: { latencyMs: 400, downKbps: 400, failureRate: 0.3 },
  "low-end-4g": { latencyMs: 300, downKbps: 2000, failureRate: 0.02 },
});

export class NetworkProfileError extends Error { constructor(message, code) { super(message); this.code = code; } }

export function getProfile(name) {
  if (typeof name !== "string" || !Object.hasOwn(PROFILES, name)) {
    throw new NetworkProfileError(`unknown_profile: '${name}'. Profiles: ${Object.keys(PROFILES).join(", ")}`, "unknown_profile");
  }
  return { name, ...PROFILES[name] };
}

// mulberry32: small seeded PRNG, so a fixed seed fails the same requests each run.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realClock = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Wrap a fetch. `profile` is a name or a { latencyMs, downKbps, failureRate } object. `clock.sleep(ms)` is injectable. */
export function applyProfile(fetchImpl, profile, { seed = 1, clock = realClock } = {}) {
  const p = typeof profile === "string" ? getProfile(profile) : profile;
  const next = prng(seed);
  return async function profiledFetch(input, init) {
    if (p.failureRate >= 1 || p.downKbps === 0) throw new TypeError("Failed to fetch: network is offline");
    if (p.failureRate > 0 && next() < p.failureRate) {
      await clock.sleep(p.latencyMs);
      throw new TypeError("Failed to fetch: network request failed");
    }
    const res = await fetchImpl(input, init);
    const bytes = res.body == null ? 0 : (await res.clone().arrayBuffer()).byteLength;
    const wait = p.latencyMs + (Number.isFinite(p.downKbps) ? (bytes * 8) / p.downKbps : 0);
    if (wait > 0) await clock.sleep(wait);
    return res;
  };
}
