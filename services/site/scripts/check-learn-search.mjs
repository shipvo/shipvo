// Unit tests for Learn search and filters (issue #456), run against the index the build writes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { searchIndex, facetCounts, parseState, toQuery, parseMinutes, timeBucket, isActive } from '../public/learn-search.js';
const site = fileURLToPath(new URL('..', import.meta.url));
execFileSync('node', ['build.mjs'], { cwd: site, stdio: 'ignore' });
const idx = JSON.parse(readFileSync(join(site, 'public/learn/index.json'), 'utf8'));
const fail = [], eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const S = (o) => ({ q: '', type: '', goal: '', level: '', time: '', ...o });
const titles = (o) => searchIndex(idx, S(o)).map((e) => e.title);

// the index covers all three kinds
for (const t of ['tutorial', 'video', 'glossary']) if (!idx.some((e) => e.type === t)) fail.push(`index has no ${t}`);
eq(titles({}).length, idx.length, 'no filters returns everything');

// search: titles, descriptions, headings, transcripts, glossary words
if (!titles({ q: 'simulator' }).length) fail.push('q=simulator finds nothing');
const vid = idx.find((e) => e.type === 'video'), word = vid.text.split(/\s+/).find((w) => /^[a-z]{9,}$/.test(w));
if (!searchIndex(idx, S({ q: word })).some((e) => e.path === vid.path)) fail.push(`transcript word "${word}" does not find its video`);
const tut = idx.find((e) => e.type === 'tutorial' && e.headings.length), head = tut.headings[0];
if (!searchIndex(idx, S({ q: head })).some((e) => e.path === tut.path)) fail.push('heading text does not find its tutorial');
if (!titles({ q: 'terminal' }).some((t) => t === 'Terminal')) fail.push('glossary entry "Terminal" not found');
eq(titles({ q: 'zzzqqq' }), [], 'nonsense query is empty');
eq(titles({ q: 'SIMULATOR' }), titles({ q: 'simulator' }), 'search ignores case');
if (searchIndex(idx, S({ q: 'terminal' }))[0].title !== 'Terminal') fail.push('exact title match should rank first');
if (titles({ q: 'phone simulator' }).length > titles({ q: 'simulator' }).length) fail.push('more words must not widen the results');

// each filter
for (const t of ['tutorial', 'video', 'glossary']) { const r = searchIndex(idx, S({ type: t })); if (!r.length || r.some((e) => e.type !== t)) fail.push(`type=${t}`); }
for (const g of ['start', 'sell', 'ship-updates']) { const r = searchIndex(idx, S({ goal: g })); if (!r.length || r.some((e) => e.goal !== g)) fail.push(`goal=${g}`); }
eq(searchIndex(idx, S({ goal: 'sell' })).some((e) => e.type === 'glossary'), false, 'goal filter drops glossary');
{ const r = searchIndex(idx, S({ level: 'beginner' })); if (!r.length || r.some((e) => e.level !== 'beginner')) fail.push('level=beginner'); }
eq(titles({ level: 'advanced' }), [], 'level=advanced has none yet');
{ const r = searchIndex(idx, S({ time: 'under-10' })); if (!r.length || r.some((e) => timeBucket(e.minutes) !== 'under-10')) fail.push('time=under-10'); }
eq(titles({ time: 'over-30' }), [], 'time=over-30 has none yet');

// combinations
{ const r = searchIndex(idx, S({ type: 'video', goal: 'start' })); if (r.length !== 1 || r[0].type !== 'video') fail.push('type=video&goal=start should be one video'); }
eq(titles({ type: 'glossary', goal: 'sell' }), [], 'glossary and goal never overlap');
{ const r = searchIndex(idx, S({ q: 'update', type: 'video' })); if (r.some((e) => e.type !== 'video')) fail.push('search plus type'); }

// counts follow the other filters and the query, not their own
const c = facetCounts(idx, S({ type: 'video' }), 'type');
eq(c.video, idx.filter((e) => e.type === 'video').length, 'type count ignores own selection');
eq(c.tutorial, idx.filter((e) => e.type === 'tutorial').length, 'type counts show the alternatives');
eq(facetCounts(idx, S({ type: 'glossary' }), 'goal').sell, 0, 'goal count follows type');
eq(Object.values(facetCounts(idx, S({ q: 'zzzqqq' }), 'type')).reduce((a, b) => a + b, 0), 0, 'counts follow the query');

// URL state
eq(parseState('?type=video&goal=sell'), S({ type: 'video', goal: 'sell' }), 'parse');
eq(parseState('?type=nope&level=Beginner&q=%20hi%20'), S({ q: 'hi' }), 'parse drops unknown values');
eq(toQuery(S({ type: 'video', goal: 'sell' })), '?type=video&goal=sell', 'toQuery');
eq(toQuery(S({})), '', 'empty state has no query');
const rt = S({ q: 'ship it', type: 'tutorial', goal: 'start', level: 'beginner', time: '10-30' });
eq(parseState(toQuery(rt)), rt, 'URL round trip');
eq([isActive(S({})), isActive(S({ q: ' ' })), isActive(S({ time: '10-30' }))], [false, false, true], 'isActive');

// time parsing
eq([parseMinutes('1 min 39 s'), parseMinutes('about two minutes of commands'), parseMinutes('45 minutes'), parseMinutes('1 hour'), parseMinutes('whenever')], [1 + 39 / 60, 2, 45, 60, null], 'parseMinutes');
eq([timeBucket(9.9), timeBucket(10), timeBucket(30), timeBucket(31), timeBucket(null)], ['under-10', '10-30', '10-30', 'over-30', ''], 'timeBucket');

if (fail.length) { console.error('learn search check failed:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('learn search check ok');
