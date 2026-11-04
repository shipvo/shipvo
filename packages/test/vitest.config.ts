import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The examples import from "@shipvo/test", like user code does. Point that at the source, so tests need no build.
const src = (f: string) => fileURLToPath(new URL(`./src/${f}`, import.meta.url));
export default defineConfig({
  resolve: { alias: [{ find: "@shipvo/test/vitest", replacement: src("vitest.ts") }, { find: /^@shipvo\/test$/, replacement: src("index.ts") }] },
});
