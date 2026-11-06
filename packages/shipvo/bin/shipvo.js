#!/usr/bin/env node
// `shipvo` is the short name of @shipvo/cli, so `npx shipvo ...` and `npm i -g shipvo` work.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const pkg = require.resolve("@shipvo/cli/package.json");
const bin = require("@shipvo/cli/package.json").bin.shipvo;
await import(pathToFileURL(new URL(bin, pathToFileURL(pkg)).pathname).href);
