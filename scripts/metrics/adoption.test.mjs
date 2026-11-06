import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { collect, parseArgs, listPackages } from './adoption.mjs';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

function fakeFetch({ failUrl, issues } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (failUrl && url.includes(failUrl)) return fail(403);
    if (url.includes('api.npmjs.org')) return ok({ downloads: 7 });
    if (url.endsWith('/repos/shipvo/shipvo')) return ok({ stargazers_count: 12, forks_count: 3, owner: { login: 'owner1' } });
    if (url.includes('/issues?')) return ok(issues ?? []);
    throw new Error('unexpected ' + url);
  };
  f.calls = calls;
  return f;
}

const now = new Date('2026-11-06T00:00:00Z');

test('success', async () => {
  const f = fakeFetch({ issues: [{ user: { login: 'someone' } }] });
  const r = await collect({ fetch: f, packages: ['@shipvo/cli', 'shipvo'], now });
  assert.deepEqual(r.npm, { '@shipvo/cli': 7, shipvo: 7 });
  assert.deepEqual(r.github, { stars: 12, forks: 3, outsideIssues: 1 });
  assert.equal(r.readAt, '2026-11-06T00:00:00.000Z');
  assert.deepEqual(r.errors, []);
});

test('failed call gives null and an error entry', async () => {
  const f = fakeFetch({ failUrl: 'last-week/shipvo' });
  const r = await collect({ fetch: f, packages: ['@shipvo/cli', 'shipvo'], now });
  assert.equal(r.npm.shipvo, null);
  assert.equal(r.npm['@shipvo/cli'], 7);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].status, 403);
  assert.match(r.errors[0].url, /last-week\/shipvo$/);
});

test('outside-author filter uses defaults and owner', async () => {
  const issues = ['claude[bot]', 'github-actions[bot]', 'owner1', 'Alice', 'bob'].map((login) => ({ user: { login } }));
  const r = await collect({ fetch: fakeFetch({ issues }), packages: [], now });
  assert.equal(r.github.outsideIssues, 2);
});

test('--team overrides the default list', async () => {
  const issues = ['claude[bot]', 'owner1', 'alice'].map((login) => ({ user: { login } }));
  const r = await collect({ fetch: fakeFetch({ issues }), packages: [], team: ['alice'], now });
  assert.equal(r.github.outsideIssues, 2);
});

test('token is sent to GitHub only and never in output', async () => {
  const f = fakeFetch();
  const r = await collect({ fetch: f, packages: ['shipvo'], token: 'sekret', now });
  assert.ok(!JSON.stringify(r).includes('sekret'));
  for (const c of f.calls) {
    const sent = c.init.headers.authorization;
    assert.equal(sent, c.url.includes('github.com') ? 'Bearer sekret' : undefined);
  }
});

test('failed repo call nulls github fields', async () => {
  const r = await collect({ fetch: fakeFetch({ failUrl: '/repos/shipvo/shipvo' }), packages: [], now });
  assert.deepEqual(r.github, { stars: null, forks: null, outsideIssues: null });
  assert.ok(r.errors.length >= 1);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--strict', '--out', 'x.json', '--team', 'a, b']), { strict: true, out: 'x.json', team: ['a', 'b'] });
  assert.throws(() => parseArgs(['--nope']));
});

test('listPackages skips private packages', () => {
  const names = listPackages(new URL('../..', import.meta.url).pathname);
  assert.ok(names.includes('shipvo') && names.includes('create-shipvo') && names.includes('@shipvo/cli'));
});

test('exit codes: 0 by default, 1 with --strict, when network is unreachable', () => {
  const env = { ...process.env, NODE_OPTIONS: `--import=${new URL('./offline.fixture.mjs', import.meta.url).href}` };
  const script = new URL('./adoption.mjs', import.meta.url).pathname;
  const a = spawnSync('node', [script], { env, encoding: 'utf8' });
  assert.equal(a.status, 0);
  const j = JSON.parse(a.stdout);
  assert.equal(j.github.stars, null);
  assert.ok(j.errors.length > 0);
  const b = spawnSync('node', [script, '--strict'], { env, encoding: 'utf8' });
  assert.equal(b.status, 1);
});
