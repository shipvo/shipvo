// Guards the phone layout of docs pages: inline code must wrap, and the
// Copy button must be a 44 px tap target on touch screens.
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../public/docs.css", import.meta.url), "utf8");
const fail = (m) => { console.error("docs overflow check failed: " + m); process.exit(1); };
if (!/\.prose :not\(pre\)>code\{[^}]*overflow-wrap:anywhere/.test(css)) fail("inline code in .prose must set overflow-wrap:anywhere");
if (!/@media \(pointer:coarse\)\{\.code-bar \.copy\{[^}]*min-height:44px/.test(css)) fail("Copy button needs min-height:44px on coarse pointers");
console.log("docs overflow check ok");
