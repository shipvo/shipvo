// Network profiles for the simulator. Pure functions: no sim wiring.
//
// The numbers below are simulation settings, not measurements of any real
// network. `latencyMs` is a fixed wait per request, `downKbps` is the
// throughput used to turn bytes into wait time, and `failureRate` is the share
// of requests that fail with a network error (0 to 1).
//
// `low-end-4g` uses the download rate seen on the Android phone in
// docs/spike-results.md, section "Results so far": a 1.57 MB bundle in 1.4 to
// 2.0 s over 4G, which is about 6,300 kbps at the slow end. That section does
// not record a round-trip time, so its latency is a simulation setting.

export const PROFILES = Object.freeze({
  online: Object.freeze({ latencyMs: 0, downKbps: Infinity, failureRate: 0 }),
  offline: Object.freeze({ latencyMs: 0, downKbps: 0, failureRate: 1 }),
  '2g': Object.freeze({ latencyMs: 800, downKbps: 50, failureRate: 0.02 }),
  '3g': Object.freeze({ latencyMs: 300, downKbps: 750, failureRate: 0.01 }),
  'slow-4g': Object.freeze({ latencyMs: 150, downKbps: 1600, failureRate: 0 }),
  spotty: Object.freeze({ latencyMs: 400, downKbps: 500, failureRate: 0.3 }),
  'low-end-4g': Object.freeze({ latencyMs: 100, downKbps: 6300, failureRate: 0.005 }),
});

export const PROFILE_NAMES = Object.freeze(Object.keys(PROFILES));

export function getProfile(name) {
  if (typeof name !== 'string' || !Object.hasOwn(PROFILES, name)) {
    const err = new Error(
      `Unknown network profile "${String(name)}". Use one of: ${PROFILE_NAMES.join(', ')}.`,
    );
    err.code = 'unknown_profile';
    throw err;
  }
  return PROFILES[name];
}

// mulberry32: small seeded PRNG, returns numbers in [0, 1).
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

function bodyBytes(body) {
  if (body == null) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).length;
  if (typeof body.byteLength === 'number') return body.byteLength;
  if (typeof body.size === 'number') return body.size;
  return 0;
}

function transferMs(bytes, downKbps) {
  if (!bytes || !Number.isFinite(downKbps)) return 0;
  return (bytes * 8) / downKbps;
}

/**
 * Wrap `fetchImpl` so requests behave as `profile` describes.
 * Waits latencyMs + bytes*8/downKbps (request body bytes, then the response's
 * content-length when present) through `clock.sleep(ms)`. Rejects with a
 * network TypeError at `failureRate`, drawn from a PRNG seeded by `seed`.
 */
export function applyProfile(fetchImpl, profile, { seed = 1, clock } = {}) {
  if (profile === PROFILES.online) return fetchImpl;
  const random = prng(seed);
  const fail = () => new TypeError('fetch failed: network request failed');
  return async function profiledFetch(input, init) {
    if (profile.failureRate >= 1) throw fail();
    // One draw per request keeps the failing set stable for a seed.
    const failed = random() < profile.failureRate;
    const reqBytes = bodyBytes(init?.body ?? input?.body);
    await clock.sleep(profile.latencyMs + transferMs(reqBytes, profile.downKbps));
    if (failed) throw fail();
    const res = await fetchImpl(input, init);
    const len = Number(res?.headers?.get?.('content-length'));
    const extra = transferMs(Number.isFinite(len) ? len : 0, profile.downKbps);
    if (extra > 0) await clock.sleep(extra);
    return res;
  };
}
