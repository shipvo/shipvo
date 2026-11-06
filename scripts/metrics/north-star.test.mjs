import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compute, main, formatTable } from './north-star.mjs';

const now = new Date('2026-11-06T12:00:00Z');
const rows = [
  { app_id: 'tide-and-tackle', event: 'healthy', received_at: '2026-11-05T10:00:00Z' },
  { app_id: 'acme', event: 'healthy', received_at: '2026-11-05T10:00:00Z' },
  { app_id: 'acme', event: 'healthy', received_at: '2026-11-04T10:00:00Z' },
  { app_id: 'beta', event: 'healthy', received_at: '2026-11-01T10:00:00Z' },
  { app_id: 'gamma', event: 'applied', received_at: '2026-11-05T10:00:00Z' },
  { app_id: 'old', event: 'healthy', received_at: '2026-10-20T10:00:00Z' },
];

function run(argv, env = {}) {
  const out = [], err = [];
  const code = main(argv, env, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('counts exactly 2 outside apps', () => {
  const r = compute(rows, now);
  assert.equal(r.apps, 2);
  assert.equal(r.healthyRows, 3);
});

test('json shape is stable', () => {
  assert.deepEqual(compute(rows, now), {
    metric: 'north-star',
    windowDays: 7,
    since: '2026-10-30T12:00:00.000Z',
    until: '2026-11-06T12:00:00.000Z',
    excludedApp: 'tide-and-tackle',
    apps: 2,
    healthyRows: 3,
  });
  assert.match(formatTable(compute(rows, now)), /apps with a healthy release\s+2/);
});

test('--fixture --json prints parseable JSON', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'ns-')), 'rows.json');
  const recent = new Date(Date.now() - 3600000).toISOString();
  writeFileSync(f, JSON.stringify([{ app_id: 'x', event: 'healthy', received_at: recent }]));
  const r = run(['--fixture', f, '--json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).apps, 1);
});

test('no credentials and no fixture: exit 1, one line', () => {
  const r = run([], {});
  assert.equal(r.code, 1);
  assert.equal(r.err.split('\n').length, 1);
  assert.match(r.err, /CLOUDFLARE_API_TOKEN/);
});

test('token value is never printed', () => {
  const r = run(['--bogus'], { CLOUDFLARE_API_TOKEN: 'sekret-token', CLOUDFLARE_ACCOUNT_ID: 'a' });
  assert.equal(r.code, 1);
  assert.ok(!r.err.includes('sekret-token') && !r.out.includes('sekret-token'));
});
