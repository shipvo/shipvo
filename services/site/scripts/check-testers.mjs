// shipvo.dev/testers redirects to the Shipvo Testers Google Group join page (issue #517).
const { default: worker } = await import('../src/index.ts');
const env = { ASSETS: { fetch: async () => new Response('ok') }, API: 'https://api.invalid' };
const fail = [];
for (const p of ['/testers', '/testers/']) {
  const r = await worker.fetch(new Request('https://shipvo.dev' + p), env);
  if (r.status !== 302 || r.headers.get('location') !== 'https://groups.google.com/g/shipvo-testers') fail.push(`${p}: got ${r.status} ${r.headers.get('location')}`);
}
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('testers redirect ok');
