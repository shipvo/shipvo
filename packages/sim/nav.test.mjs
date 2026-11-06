import test from "node:test";
import assert from "node:assert/strict";
import { createNav, pressHome, openRecents, resume, killApp, setNavStyle, assertForeground, classifySwipe } from "./nav.mjs";

test("home backgrounds the app, resume brings it back, kill needs recents", () => {
  const st = createNav();
  assert.equal(pressHome(st), "background"); assert.equal(st.where, "home");
  assert.throws(() => assertForeground(st), { code: "app_not_foreground" });
  assert.equal(pressHome(st), null);
  assert.throws(() => killApp(st), { code: "recents_not_open" });
  assert.equal(resume(st), "active");
  assert.throws(() => resume(st), { code: "app_in_foreground" });
  assert.equal(openRecents(st), "background");
  killApp(st); assert.equal(st.where, "home"); assert.equal(st.kills, 1);
  assert.deepEqual(st.log.map((e) => e.name), ["press_home", "press_home", "resume", "open_recents", "kill_app"]);
});

test("navigation style", () => {
  const st = createNav(); setNavStyle(st, "buttons"); assert.equal(st.navStyle, "buttons");
  assert.throws(() => setNavStyle(st, "x"), { code: "bad_nav_style" });
});

test("swipes: up is home, up and hold is recents, along the bar switches on iPhone, left edge is back", () => {
  assert.equal(classifySwipe({ skin: "ios", fromEdge: "bottom", dy: -200, ms: 150 }), "home");
  assert.equal(classifySwipe({ skin: "ios", fromEdge: "bottom", dy: -200, ms: 700 }), "recents");
  assert.equal(classifySwipe({ skin: "ios", fromEdge: "bottom", dx: 120, dy: 5, ms: 200 }), "switch-right");
  assert.equal(classifySwipe({ skin: "android", fromEdge: "bottom", dx: 120, dy: 5, ms: 200 }), null);
  assert.equal(classifySwipe({ skin: "ios", fromEdge: "left", dx: 100, dy: 10, ms: 200 }), "back");
  assert.equal(classifySwipe({ skin: "ios", fromEdge: null, dx: 100 }), null);
});
