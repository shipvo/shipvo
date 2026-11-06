#!/usr/bin/env node
// `npm create shipvo [dir] [-- options]` runs `shipvo init [dir] [options]`.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const pkg = require.resolve("@shipvo/cli/package.json");
const bin = require("@shipvo/cli/package.json").bin.shipvo;
process.argv.splice(2, 0, "init");
// Import the file URL itself. Its path part is "/C:/..." on Windows, and pathToFileURL made that C:/C:/... (#573).
await import(new URL(bin, pathToFileURL(pkg)).href);
