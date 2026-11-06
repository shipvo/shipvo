// Guards phone tap targets (44 px): the Copy button on terminal blocks, "Edit on GitHub",
// legal links and roadmap issue links must keep a 44 px minimum at phone width.
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const site = read("site.css"), road = read("roadmap.css");
const phone = site.slice(site.indexOf("@media(max-width:980px){"));
const fail = (m) => { console.error("tap targets check failed: " + m); process.exit(1); };
for (const sel of ["pre.term .term-copy", ".edit", ".legal-nav a", ".legal-links a"]) {
  const re = new RegExp("html body " + sel.replace(/[.]/g, "\\.") + "[^{]*\\{[^}]*min-height:44px");
  if (!re.test(phone)) fail(`${sel} needs min-height:44px in the max-width:980px block of site.css`);
}
if (!/\.rm-issue[^{]*\{[^}]*min-width:44px/.test(road)) fail("roadmap issue links need min-width:44px");
console.log("tap targets check ok");
