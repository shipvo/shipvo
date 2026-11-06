#!/usr/bin/env node
// North-star metric: distinct apps other than the sample app with a healthy release (`applied` or `content_applied`) in the last 7 days.
// Read-only. Reads the control-plane `telemetry` table from D1 (wrangler) or from a --fixture file.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SAMPLE_APP = 'tide-and-tackle';
export const DAYS = 7;
const DB = 'purenative';
const CONTROL_PLANE = fileURLToPath(new URL('../../services/control-plane', import.meta.url));
// Same list as HEALTHY_EVENTS in services/control-plane/src/halt.ts. Keep them in step.
export const HEALTHY_EVENTS = ['applied', 'content_applied'];

export function parseArgs(argv) {
  const o = { fixture: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--fixture') {
      o.fixture = argv[++i];
      if (!o.fixture) throw new Error('--fixture needs a file');
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

export function compute(rows, now = new Date()) {
  const since = new Date(now.getTime() - DAYS * 86400000);
  const apps = new Set();
  let healthyRows = 0;
  for (const r of rows) {
    if (!r || !HEALTHY_EVENTS.includes(r.event) || !r.app_id || r.app_id === SAMPLE_APP) continue;
    const t = Date.parse(r.received_at);
    if (Number.isNaN(t) || t < since.getTime() || t > now.getTime()) continue;
    apps.add(r.app_id);
    healthyRows++;
  }
  return {
    metric: 'north-star',
    windowDays: DAYS,
    since: since.toISOString(),
    until: now.toISOString(),
    excludedApp: SAMPLE_APP,
    apps: apps.size,
    healthyRows,
  };
}

export function formatTable(r) {
  return [
    `North star, last ${r.windowDays} days (apps other than ${r.excludedApp})`,
    `apps with a healthy release  ${r.apps}`,
    `healthy rows                 ${r.healthyRows}`,
  ].join('\n');
}

export function hasCredentials(env) {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
}

export function readFixture(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const rows = Array.isArray(j) ? j : j.rows ?? j.results;
  if (!Array.isArray(rows)) throw new Error('fixture must be an array of rows');
  return rows;
}

export function readRemote(now = new Date(), run = execFileSync) {
  const since = new Date(now.getTime() - DAYS * 86400000).toISOString();
  const sql = `SELECT app_id, event, received_at FROM telemetry WHERE event IN (${HEALTHY_EVENTS.map((e) => `'${e}'`).join(',')}) AND received_at >= '${since}'`;
  const out = run('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], {
    cwd: CONTROL_PLANE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const j = JSON.parse(out);
  return (Array.isArray(j) ? j : [j]).flatMap((x) => x.results ?? []);
}

export function main(argv, env = process.env, io = { out: (s) => console.log(s), err: (s) => console.error(s) }, now = new Date()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    io.err(`north-star: ${e.message}`);
    return 1;
  }
  if (!o.fixture && !hasCredentials(env)) {
    io.err('north-star: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or pass --fixture <file>.');
    return 1;
  }
  let rows;
  try {
    rows = o.fixture ? readFixture(o.fixture) : readRemote(now);
  } catch (e) {
    // Never echo the underlying error: wrangler output could contain secrets.
    io.err(o.fixture ? `north-star: cannot read fixture: ${e.message}` : 'north-star: the D1 query failed. Check the credentials and that wrangler can reach Cloudflare.');
    return 1;
  }
  const r = compute(rows, now);
  io.out(o.json ? JSON.stringify(r, null, 2) : formatTable(r));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
