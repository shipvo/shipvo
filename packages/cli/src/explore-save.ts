// Save findings as `@shipvo/test` files. Used by `shipvo explore --save-tests` and the "save bug" command in `shipvo lumi`.
// File names come from the finding kind (a closed list) and a counter. Text from the app never reaches a path.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportTest } from "./explore-tests.js";
import type { Finding } from "./explore.js";

/** `lumi-<kind>-<n>.test.ts`. A kind outside the closed list becomes `error`; the slug keeps only a-z and `-`. */
export function testFileName(kind: string, n: number): string {
  const slug = String(kind).toLowerCase().replace(/_/g, "-");
  const safe = /^[a-z]+(?:-[a-z]+)*$/.test(slug) && slug.length <= 20 ? slug : "error";
  return `lumi-${safe}-${Math.max(1, Math.floor(n) || 1)}.test.ts`;
}

/** Writes one file per finding that `exportTest` can prove. The counter is the finding's position, so names stay stable. Returns the file paths. */
export function saveTests(findings: Finding[], dir: string, first = 1): string[] {
  const files: string[] = [];
  findings.forEach((f, i) => {
    const src = exportTest(f);
    if (src === null) return;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, testFileName(f.kind, first + i));
    writeFileSync(file, src);
    files.push(file);
  });
  return files;
}
