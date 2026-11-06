#!/usr/bin/env node
// Reads public adoption numbers: npm downloads, GitHub stars/forks, outside issues.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'shipvo/shipvo';
const MAX_PAGES = 20;

export function parseArgs(argv) {
  const o = { team: null, out: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') o.strict = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--team') o.team = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

export function listPackages(root) {
  const dir = join(root, 'packages');
  const names = [];
  for (const d of readdirSync(dir)) {
    const f = join(dir, d, 'package.json');
    if (!existsSync(f)) continue;
    const p = JSON.parse(readFileSync(f, 'utf8'));
    if (p.private || !p.name) continue;
    names.push(p.name);
  }
  return names.sort();
}

export async function collect({ fetch: f = fetch, packages, team, token, now = new Date() }) {
  const errors = [];
  const headers = { accept: 'application/json', 'user-agent': 'shipvo-adoption' };
  const ghHeaders = { ...headers, accept: 'application/vnd.github+json' };
  if (token) ghHeaders.authorization = `Bearer ${token}`;

  async function getJson(url, h) {
    try {
      const res = await f(url, { headers: h });
      if (!res.ok) {
        errors.push({ url, status: res.status });
        return null;
      }
      return await res.json();
    } catch (e) {
      errors.push({ url, status: 0, message: String(e?.message ?? e) });
      return null;
    }
  }

  const npm = {};
  for (const name of packages) {
    const url = `https://api.npmjs.org/downloads/point/last-week/${name}`;
    const j = await getJson(url, headers);
    npm[name] = j && typeof j.downloads === 'number' ? j.downloads : null;
  }

  const repoUrl = `https://api.github.com/repos/${REPO}`;
  const repo = await getJson(repoUrl, ghHeaders);
  const github = {
    stars: repo ? repo.stargazers_count ?? null : null,
    forks: repo ? repo.forks_count ?? null : null,
    outsideIssues: null,
  };

  const owner = repo?.owner?.login;
  const teamList = team ?? ['claude[bot]', 'github-actions[bot]', ...(owner ? [owner] : [])];
  const teamSet = new Set(teamList.map((s) => s.toLowerCase()));
  if (!team && !owner) {
    // Without the owner login the count would include the owner's own issues.
    errors.push({ url: repoUrl, status: 0, message: 'owner login missing; outsideIssues not computed' });
  } else {
    let count = 0;
    let ok = true;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${repoUrl}/issues?state=all&per_page=100&page=${page}`;
      const items = await getJson(url, ghHeaders);
      if (!Array.isArray(items)) { ok = false; break; }
      for (const it of items) {
        const login = it?.user?.login;
        if (login && !teamSet.has(login.toLowerCase())) count++;
      }
      if (items.length < 100) break;
      if (page === MAX_PAGES) {
        ok = false;
        errors.push({ url, status: 0, message: `more than ${MAX_PAGES} pages; count incomplete` });
      }
    }
    github.outsideIssues = ok ? count : null;
  }

  return { npm, github, readAt: now.toISOString(), errors };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = await collect({
    packages: listPackages(root),
    team: opts.team,
    token: process.env.GITHUB_TOKEN,
  });
  const text = JSON.stringify(result, null, 2) + '\n';
  if (opts.out) writeFileSync(opts.out, text);
  process.stdout.write(text);
  if (opts.strict && result.errors.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(2);
  });
}
