// Guards 44 px phone tap targets on home, apps, features and brand, and the hidden docs "#" anchor on touch screens.
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const site = read("public/site.css"), store = read("public/store.css"), docs = read("public/docs.css"), feat = read("pages/features.html");
const start = site.indexOf("@media(max-width:980px){");
const phone = site.slice(start, site.indexOf("@media", start + 1));
const fail = (m) => { console.error("phone tap targets check failed: " + m); process.exit(1); };
for (const sel of [".panel-grid .link", ".search", ".search input", ".dl a"]) {
  const re = new RegExp("html body " + sel.replace(/\./g, "\\.") + "\\{[^}]*min-height:44px");
  if (!re.test(phone)) fail(`${sel} needs min-height:44px in the max-width:980px block of site.css`);
}
if (!/html body \.panel-grid \.link\{[^}]*min-width:44px/.test(phone)) fail(".panel-grid .link needs min-width:44px");
if (!/html body \.dl a\{[^}]*min-width:44px/.test(phone)) fail(".dl a needs min-width:44px");
if (!/\.cat-rail button\{[^}]*min-height:44px/.test(store)) fail(".cat-rail button needs min-height:44px in store.css");
if (!/\.cat-rail\{[^}]*gap:8px/.test(store)) fail(".cat-rail needs gap:8px");
if (!/\.feat \.link\{[^}]*min-height:44px[^}]*min-width:44px|\.feat \.link\{[^}]*min-width:44px[^}]*min-height:44px/.test(feat)) fail(".feat .link needs 44 px height and width in features.html");
if (!/@media\(hover:none\)\{[^}]*\.prose \.anchor\{display:none\}/.test(docs)) fail('docs.css must hide ".prose .anchor" on (hover:none)');
console.log("phone tap targets check ok");
