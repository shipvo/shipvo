// A page opened straight in a browser (not through a simulator session) has no __PN_SIM__ from the session,
// so the simulated device would call the app "This app". Put the app's name from shipvo.json in the page.
// A session's own value wins: the script only fills in what is missing.
export function withAppName(html, name) {
  const json = JSON.stringify(String(name)).replace(/</g, "\\u003c");
  const tag = `<script>globalThis.__PN_SIM__=globalThis.__PN_SIM__||{};globalThis.__PN_SIM__.appName=globalThis.__PN_SIM__.appName||${json};</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}
