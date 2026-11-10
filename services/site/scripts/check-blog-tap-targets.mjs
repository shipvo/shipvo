// Guards phone tap targets (44 px) on blog pages: "← All posts", the RSS/X/GitHub feed links
// "All posts →" in related articles and the "In this article" links must keep a 44 px minimum at phone width.
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../public/blog.css", import.meta.url), "utf8");
const start = css.indexOf("@media(max-width:980px){\n.post-head .back");
const phone = start === -1 ? "" : css.slice(start);
const fail = (m) => { console.error("blog tap targets check failed: " + m); process.exit(1); };
for (const sel of [".post-head .back", ".feed a", ".related-head a", ".contents a"]) {
  const re = new RegExp(sel.replace(/\./g, "\\.") + "\\{[^}]*min-height:44px");
  if (!re.test(phone)) fail(`${sel} needs min-height:44px in the max-width:980px block of blog.css`);
}
if (!/\.feed a\{[^}]*min-width:44px/.test(phone)) fail(".feed a needs min-width:44px in the max-width:980px block of blog.css");
console.log("blog tap targets check ok");
