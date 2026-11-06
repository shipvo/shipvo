import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compute, main, formatTable, readRemote, HEALTHY_EVENTS } from './north-star.mjs';

const now = new Date('2026-11-06T12:00:00Z');
const rows = [
  { app_id: 'tide-and-tackle', event: 'applied', received_at: '2026-11-05T10:00:00Z' },
  { app_id: 'acme', event: 'applied', received_at: '2026-11-05T10:00:00Z' },
  { app_id: 'acme', event: 'applied', received_at: '2026-11-04T10:00:00Z' },
  { app_id: 'beta', event: 'content_applied', received_at: '2026-11-01T10:00:00Z' },
  { app_id: 'gamma', event: 'rolled_back', received_at: '2026-11-05T10:00:00Z' },
  { app_id: 'old', event: 'applied', received_at: '2026-10-20T10:00:00Z' },
];

function run(argv, env = {}, at = new Date()) {
  const out = [], err = [];
  const code = main(argv, env, { out: (s) => out.push(s), err: (s) => err.push(s) }, at);
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
  const recent = '2026-11-06T11:00:00Z';
  writeFileSync(f, JSON.stringify([{ app_id: 'x', event: 'applied', received_at: recent }]));
  const r = run(['--fixture', f, '--json'], {}, now);
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

test('healthy events match the control plane list', () => {
  assert.deepEqual(HEALTHY_EVENTS, ['applied', 'content_applied']);
});

test('readRemote runs one read-only SELECT in the control plane', () => {
  let call;
  const run = (cmd, args, opts) => {
    call = { cmd, args, opts };
    return JSON.stringify([{ results: [{ app_id: 'a', event: 'applied', received_at: '2026-11-05T00:00:00Z' }] }]);
  };
  const rows = readRemote(now, run);
  assert.equal(rows.length, 1);
  assert.equal(call.cmd, 'npx');
  assert.ok(call.args.includes('--remote'));
  assert.match(call.opts.cwd.replace(/\\/g, '/'), /services\/control-plane$/);
  const sql = call.args[call.args.indexOf('--command') + 1];
  assert.match(sql, /^SELECT /);
  assert.ok(!sql.includes(';'));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(sql));
  assert.match(sql, /event IN \('applied','content_applied'\)/);
});
