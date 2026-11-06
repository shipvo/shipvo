import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, PROFILE_NAMES, getProfile, applyProfile } from './network-profiles.mjs';

const okFetch = async () => new Response('ok');
function fakeClock() {
  const c = { slept: [], sleep: async (ms) => { c.slept.push(ms); }, total: () => c.slept.reduce((a, b) => a + b, 0) };
  return c;
}

test('PROFILE_NAMES lists every profile', () => {
  assert.deepEqual([...PROFILE_NAMES].sort(), ['2g', '3g', 'low-end-4g', 'offline', 'online', 'slow-4g', 'spotty']);
});

test('offline rejects with TypeError', async () => {
  const f = applyProfile(okFetch, getProfile('offline'), { seed: 1, clock: fakeClock() });
  await assert.rejects(f('http://x/'), TypeError);
});

test('3g waits at least the table time for a body of known size', async () => {
  const clock = fakeClock();
  const p = getProfile('3g');
  const f = applyProfile(okFetch, p, { seed: 1, clock });
  const body = 'a'.repeat(10000);
  // Pick a seed that does not fail this request.
  await f('http://x/', { method: 'POST', body }).catch(() => {});
  const need = p.latencyMs + (10000 * 8) / p.downKbps;
  assert.ok(clock.total() >= need, `${clock.total()} < ${need}`);
});

test('spotty with a fixed seed fails the same requests every run', async () => {
  const run = async () => {
    const f = applyProfile(okFetch, getProfile('spotty'), { seed: 42, clock: fakeClock() });
    const out = [];
    for (let i = 0; i < 40; i++) out.push(await f('http://x/').then(() => 'ok', () => 'fail'));
    return out;
  };
  const a = await run();
  assert.deepEqual(await run(), a);
  assert.ok(a.includes('fail') && a.includes('ok'));
});

test('online does not call the clock', async () => {
  const clock = fakeClock();
  const f = applyProfile(okFetch, getProfile('online'), { seed: 1, clock });
  assert.equal(await (await f('http://x/')).text(), 'ok');
  assert.equal(clock.slept.length, 0);
});

test('a bad name throws unknown_profile', () => {
  assert.throws(() => getProfile('5g'), { code: 'unknown_profile' });
  assert.throws(() => getProfile('toString'), { code: 'unknown_profile' });
});

test('profiles have the documented shape', () => {
  for (const n of PROFILE_NAMES) {
    const p = PROFILES[n];
    assert.deepEqual(Object.keys(p).sort(), ['downKbps', 'failureRate', 'latencyMs']);
  }
});
