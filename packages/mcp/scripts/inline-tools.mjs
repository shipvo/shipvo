// @shipvo/mcp-tools is a private workspace package, so it is not on npm. Bundle it into dist/server.js;
// every other import stays as it is.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
await build({
  entryPoints: ["dist/server.js"],
  outfile: "dist/server.js",
  allowOverwrite: true,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: [...external, ...external.map((e) => `${e}/*`)],
  // The bundle is ESM; some bundled packages reach for require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
