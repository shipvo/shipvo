// Bundle @shipvo/mcp-tools into dist/server.js, so @shipvo/mcp runs from one file with the registry it was built with;
// every other import stays as it is.
import { build } from "esbuild";
import { readFileSync, renameSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
await build({
  entryPoints: ["dist/server.js"],
  outfile: "dist/server.bundle.tmp.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: [...external, ...external.map((e) => `${e}/*`)],
  // The bundle is ESM; some bundled packages reach for require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
// Swap in the bundle in one step, so an interrupted run never leaves a half-written dist/server.js.
renameSync("dist/server.bundle.tmp.js", "dist/server.js");
