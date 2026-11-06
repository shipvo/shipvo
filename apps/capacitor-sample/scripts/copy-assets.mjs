import { copyFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("www", { recursive: true });
copyFileSync("src/index.html", "www/index.html");
// Bundle the app with the Shipvo core so the web view needs no module resolution.
await build({
  entryPoints: ["src/main.ts"], bundle: true, format: "esm", target: "es2022", outfile: "www/main.js",
  define: {
    __SHIPVO_PUBLIC_KEY__: JSON.stringify(process.env.SHIPVO_PUBLIC_KEY ?? ""),
    __SHIPVO_BASE_URL__: JSON.stringify(process.env.SHIPVO_BASE_URL ?? ""),
  },
});
