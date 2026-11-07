import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// The containers package needs the Workers runtime; tests use a stub.
export default defineConfig({ resolve: { alias: { "@cloudflare/containers": fileURLToPath(new URL("./test/stub-containers.ts", import.meta.url)) } } });
