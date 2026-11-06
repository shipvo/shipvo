// Guards /hq phone controls: buttons, tabs, the brand link and summaries keep a 44 px
// minimum in the max-width:980px block, and the tab row scrolls inside its own container.
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../public/hq/index.html", import.meta.url), "utf8");
const fail = (m) => { console.error("hq tap targets check failed: " + m); process.exit(1); };
const start = html.indexOf("@media (max-width:980px){");
if (start === -1) fail("missing @media (max-width:980px) block");
const block = html.slice(start, html.indexOf("</style>", start));
for (const sel of [".btn,.btn.sm", "nav.tabs a", "header.top .brand", "summary", "select,input,textarea"]) {
  const i = block.indexOf(sel + "{");
  if (i === -1 || !/min-height:44px/.test(block.slice(i, block.indexOf("}", i)))) fail(`${sel} needs min-height:44px`);
}
if (!/nav\.tabs\{[^}]*overflow-x:auto/.test(html)) fail("nav.tabs must scroll inside itself (overflow-x:auto)");
console.log("hq tap targets check ok");
