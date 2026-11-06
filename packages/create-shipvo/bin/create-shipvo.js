#!/usr/bin/env node
// `npm create shipvo [dir] [-- options]` runs `shipvo init [dir] [options]`.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const pkg = require.resolve("@shipvo/cli/package.json");
const bin = require("@shipvo/cli/package.json").bin.shipvo;
process.argv.splice(2, 0, "init");
await import(pathToFileURL(resolve(dirname(pkg), bin)).href);
