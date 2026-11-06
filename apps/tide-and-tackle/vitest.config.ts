import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// @shipvo/runtime needs a device module. Tests swap in the runtime package's own stub.
const stub = fileURLToPath(new URL("../../packages/runtime/test/expo-modules-core-stub.ts", import.meta.url));
export default defineConfig({ resolve: { alias: { "expo-modules-core": stub } }, test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000 } });
