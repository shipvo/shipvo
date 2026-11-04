import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { withAppName } from "./app-name.mjs";

const run = (html, pre = {}) => {
  const script = /<script>(.*?)<\/script>/s.exec(html)[1];
  const ctx = { globalThis: null, ...pre }; ctx.globalThis = ctx; vm.runInNewContext(script, ctx);
  return ctx.__PN_SIM__;
};

test("sets the app name from shipvo.json in a page opened directly", () => {
  const html = withAppName("<html><head><title>x</title></head><body></body></html>", "Mama Ngozi Bakery");
  assert.ok(html.indexOf("__PN_SIM__") < html.indexOf("<title>"));
  assert.equal(run(html).appName, "Mama Ngozi Bakery");
});

test("keeps a name a session already set", () => {
  assert.equal(run(withAppName("<head></head>", "A"), { __PN_SIM__: { appName: "B" } }).appName, "B");
});

test("escapes names that could close the script tag", () => {
  const html = withAppName("<head></head>", "</script><b>");
  assert.equal(run(html).appName, "</script><b>");
});
