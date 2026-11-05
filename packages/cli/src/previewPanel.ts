// The device panel of the preview page. `PANEL_JS` is plain browser JavaScript: it defines `shipvoPanel(win, app)`,
// which drives the simulated device inside the app frame (`win.__pnDevice`, the same bridge MCP `set_device` uses),
// records what the person does and turns it into a @shipvo/test script. It is a string so the page needs no build step,
// and so the tests can run the exact code the page runs.
export const PANEL_JS = String.raw`
function shipvoPanel(win, app) {
  var steps = [], comments = [], last = "";
  var LS = new RegExp(String.fromCharCode(8232), "g"), PS = new RegExp(String.fromCharCode(8233), "g"), BS = String.fromCharCode(92);
  var safe = function (j) { return j.replace(LS, BS + "u2028").replace(PS, BS + "u2029"); };
  var q = function (s) { return safe(JSON.stringify(String(s))); };
  var num = function (v, name, lo, hi) { var n = Number(v); if (v === "" || v === null || !isFinite(n) || n < lo || n > hi) throw new Error(name + " must be a number from " + lo + " to " + hi); return n; };
  var dev = function () { if (!win || !win.__pnDevice) throw new Error("The app has not loaded its simulated device yet."); return win.__pnDevice; };
  function setDevice(patch) { dev().set(patch); steps.push({ action: "set_device", device: patch }); return patch; }
  function label(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      var t = (e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").trim() || (e.children.length === 0 ? (e.textContent || "").trim() : "");
      if (t) return t.slice(0, 80);
    }
    return "";
  }
  var api = {
    steps: function () { return steps.slice(); },
    comments: function () { return comments.slice(); },
    location: function (lat, lng) { return setDevice({ location: { latitude: num(lat, "Latitude", -90, 90), longitude: num(lng, "Longitude", -180, 180), accuracy: 20 } }); },
    camera: function (type, data) { return setDevice({ camera: { barcode: type && data ? { type: String(type), data: String(data) } : null } }); },
    biometrics: function (match) { return setDevice({ biometrics: { nextResult: match ? "success" : "fail" } }); },
    payment: function (approve) { return setDevice({ payment: { nextResult: approve ? "approve" : "decline" } }); },
    network: function (mode) {
      if (mode !== "online" && mode !== "offline") throw new Error("Network is online or offline. Slow is not simulated yet.");
      return setDevice({ online: mode === "online" });
    },
    push: function (title, body) {
      if (!String(title).trim()) throw new Error("A notification needs a title.");
      dev().push({ title: String(title), body: String(body || "") });
      steps.push({ action: "push", title: String(title), body: String(body || "") });
    },
    platform: function (p) { if (p !== "android" && p !== "ios") throw new Error("Platform is android or ios."); dev().set({ platform: p }); },
    // Record a tap or typed text from the app frame.
    tap: function (el) { var t = label(el); if (t) steps.push({ action: "tap", text: t }); },
    type: function (el, value) {
      var t = label(el); if (!t) return;
      var secret = !!(el && el.type === "password"), v = secret ? "" : value, l = steps[steps.length - 1];
      if (l && l.action === "type" && l.text === t) l.value = v; else steps.push({ action: "type", text: t, value: v, secret: secret });
    },
    back: function () { steps.push({ action: "back" }); if (win.history) win.history.back(); },
    comment: function (x, y, note) {
      if (!String(note).trim()) throw new Error("Write a note first.");
      var c = { screen: last || (win.document && win.document.title) || "", x: x, y: y, note: String(note), steps: steps.length, at: new Date().toISOString() };
      comments.push(c); return c;
    },
    screen: function (name) { last = name; },
    commentsFile: function () { return JSON.stringify({ app: app, simulated: true, comments: comments.map(function (c) { return Object.assign({}, c, { stepsBefore: steps.slice(0, c.steps).map(describe) }); }) }, null, 2); },
    toTest: function () {
      var out = ['import { test } from "@shipvo/test/vitest";', 'import { openApp } from "@shipvo/test";', "", "test(" + q("recorded session for " + app) + ", async () => {", "  const phone = await openApp({ app: " + q(app) + " });"];
      steps.forEach(function (s) {
        if (s.action === "set_device") out.push("  await phone.device.set(" + safe(JSON.stringify(s.device)) + ");");
        else if (s.action === "push") out.push("  await phone.notify({ title: " + q(s.title) + ", body: " + q(s.body) + " });");
        else if (s.action === "back") out.push("  await phone.back();");
        else if (s.action === "tap") out.push("  await phone.tap(" + q(s.text) + ");");
        else if (s.action === "type") out.push("  await phone.type(" + q(s.text) + ", " + (s.secret ? "process.env.SHIPVO_TEST_" + (s.text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "FIELD") + "!" : q(s.value)) + ");");
      });
      out.push("});", ""); return out.join("\n");
    },
  };
  function describe(s) { return s.action === "set_device" ? "device " + Object.keys(s.device).join(",") : s.action === "push" ? "push " + s.title : s.action + (s.text ? " " + s.text : ""); }
  return api;
}
`;

/** The same code, loaded for tests. */
export function loadPanel(): (win: unknown, app: string) => any {
  return new Function(`${PANEL_JS}; return shipvoPanel;`)() as never;
}
