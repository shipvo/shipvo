import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The module is a peer dependency and needs a device. Tests swap in a stub.
const stub = fileURLToPath(new URL("./test/expo-modules-core-stub.ts", import.meta.url));
export default defineConfig({ resolve: { alias: { "expo-modules-core": stub } } });
