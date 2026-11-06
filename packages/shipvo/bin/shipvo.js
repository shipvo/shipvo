#!/usr/bin/env node
// `shipvo` is the short name of @shipvo/cli, so `npx shipvo ...` and `npm i -g shipvo` work.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const pkg = require.resolve("@shipvo/cli/package.json");
const bin = require("@shipvo/cli/package.json").bin.shipvo;
// Import the file URL itself. Its path part is "/C:/..." on Windows, and pathToFileURL made that C:/C:/... (#573).
await import(new URL(bin, pathToFileURL(pkg)).href);
