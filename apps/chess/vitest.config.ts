import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "react-native": fileURLToPath(new URL("./test/rn-stub.ts", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: { globalSetup: ["./test/global-setup.ts"] },
});
