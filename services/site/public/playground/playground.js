// shipvo.dev/playground: one phone (Android or iOS), phone settings, and a feature sidebar with deep links (/playground/#ota).
(function () {
  var features = JSON.parse(document.getElementById("pg-features").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var phone = $("pg-phone"), state = { platform: "android", dark: false, large: false, rtl: false };
  var q = new URLSearchParams(location.search);
  if (q.get("platform") === "ios") state.platform = "ios";
  ["dark", "large", "rtl"].forEach(function (k) { if (q.get(k) === "1") state[k] = true; });

  function send() { try { phone.contentWindow.postMessage({ type: "pg:prefs", dark: state.dark, large: state.large, rtl: state.rtl }, "*"); } catch (e) {} replay(); }
  function loadPhone() { phone.title = state.platform === "ios" ? "iOS phone" : "Android phone"; phone.src = phone.getAttribute("data-src-" + state.platform); }
  phone.addEventListener("load", function () { send(); setTimeout(send, 300); });
  window.addEventListener("message", function (e) { if (e.source === phone.contentWindow && e.data && e.data.type === "pg:ready") send(); });

  // Device API controls. Each choice goes to the phone as { type: "pg:device", kind, value }; the phone replays the last choices after a reload.
  var DEVICE = [
    { kind: "location", label: "Location", opts: [["Lisbon", "Lisbon"], ["Douala", "Douala"], ["Tokyo", "Tokyo"]] },
    { kind: "camera", label: "Camera", opts: [["Sample photo: harbour", "harbour"], ["Sample photo: lighthouse", "lighthouse"], ["Deny", "denied"]] },
    { kind: "biometrics", label: "Biometrics", opts: [["Accept", "accepted"], ["Reject", "rejected"], ["Unavailable", "unavailable"]] },
    { kind: "payment", label: "Payment", opts: [["Approve", "approved"], ["Decline", "declined"], ["Time out", "timeout"]] },
    { kind: "notification", label: "Notification", opts: [["Send notification", "send"]], action: true },
    { kind: "airplane", label: "Airplane mode", opts: [["On", "on"], ["Off", "off"]] }
  ];
  var chosen = {};
  function sendDevice(kind, value) { try { phone.contentWindow.postMessage({ type: "pg:device", kind: kind, value: value }, "*"); } catch (e) {} }
  function deviceControls(panel) {
    DEVICE.forEach(function (g) {
      var fs = document.createElement("fieldset"), lg = document.createElement("legend"); lg.textContent = g.label; fs.appendChild(lg);
      g.opts.forEach(function (o) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = o[0];
        b.setAttribute("data-kind", g.kind); b.setAttribute("data-value", o[1]);
        if (!g.action) b.setAttribute("aria-pressed", String(chosen[g.kind] === o[1]));
        b.addEventListener("click", function () {
          if (!g.action) {
            chosen[g.kind] = o[1];
            Array.prototype.forEach.call(fs.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          }
          sendDevice(g.kind, o[1]);
        });
        fs.appendChild(b);
      });
      panel.appendChild(fs);
    });
  }
  function replay() { Object.keys(chosen).forEach(function (k) { sendDevice(k, chosen[k]); }); }

  // Agent panel. Tool names and result shapes follow @shipvo/mcp-tools (screen, tap, type, device_log). The phone runs each call.
  var TOOLS = [
    { name: "screen", args: [] }, { name: "tap", args: [["ref", "e1"]] },
    { name: "type", args: [["ref", "e4"], ["text", "Leave at the door"]] }, { name: "device_log", args: [] }
  ];
  var calls = {}, callId = 0;
  window.addEventListener("message", function (e) {
    var d = e.data; if (e.source !== phone.contentWindow || !d || d.type !== "pg:tool:result" || !calls[d.id]) return;
    calls[d.id](d.result); delete calls[d.id];
  });
  function callTool(tool, args) {
    return new Promise(function (res) {
      var id = ++callId, t = setTimeout(function () { delete calls[id]; res({ error: "timeout" }); }, 5000);
      calls[id] = function (r) { clearTimeout(t); res(r); };
      try { phone.contentWindow.postMessage({ type: "pg:tool", id: id, tool: tool, args: args }, "*"); } catch (e) {}
    });
  }
  function agentPanel(panel) {
    var form = document.createElement("form"); form.className = "pg-console";
    var sel = document.createElement("select"); sel.id = "pg-tool"; sel.setAttribute("aria-label", "Tool");
    TOOLS.forEach(function (t) { var o = document.createElement("option"); o.value = t.name; o.textContent = t.name; sel.appendChild(o); });
    var argBox = document.createElement("div"); argBox.id = "pg-args";
    function paintArgs() {
      argBox.textContent = "";
      TOOLS.filter(function (t) { return t.name === sel.value; })[0].args.forEach(function (a) {
        var l = document.createElement("label"); l.textContent = a[0] + " "; var i = document.createElement("input");
        i.name = a[0]; i.value = a[1]; i.setAttribute("data-arg", a[0]); l.appendChild(i); argBox.appendChild(l);
      });
    }
    sel.addEventListener("change", paintArgs); paintArgs();
    var run = document.createElement("button"); run.type = "submit"; run.id = "pg-run"; run.textContent = "Run tool";
    var out = document.createElement("pre"); out.id = "pg-out"; out.setAttribute("aria-label", "Tool result"); out.textContent = "Pick a tool and run it.";
    form.addEventListener("submit", function (ev) {
      ev.preventDefault(); var args = {};
      Array.prototype.forEach.call(argBox.querySelectorAll("input"), function (i) { args[i.getAttribute("data-arg")] = i.value; });
      callTool(sel.value, args).then(function (r) { out.textContent = JSON.stringify(r, null, 2); });
    });
    form.appendChild(sel); form.appendChild(argBox); form.appendChild(run); panel.appendChild(form); panel.appendChild(out);
    var lumi = document.createElement("button"); lumi.type = "button"; lumi.id = "pg-lumi"; lumi.textContent = "Watch Lumi";
    var cap = document.createElement("ol"); cap.id = "pg-captions"; cap.setAttribute("aria-label", "Lumi captions");
    var steps = [["Lumi reads the screen.", "screen", {}], ["Lumi taps Add Spinning rod to cart.", "tap", { ref: "e1" }], ["Lumi taps Add Tackle box to cart.", "tap", { ref: "e2" }], ["Lumi taps Add Tide chart to cart.", "tap", { ref: "e3" }]];
    lumi.addEventListener("click", function () {
      lumi.disabled = true; cap.textContent = "";
      steps.reduce(function (p, s) {
        return p.then(function () {
          var li = document.createElement("li"); li.textContent = s[0]; cap.appendChild(li);
          return callTool(s[1], s[2]).then(function (r) { out.textContent = JSON.stringify(r, null, 2); return new Promise(function (ok) { setTimeout(ok, 600); }); });
        });
      }, Promise.resolve()).then(function () { lumi.disabled = false; lumi.setAttribute("data-done", "true"); });
      lumi.removeAttribute("data-done");
    });
    panel.appendChild(lumi); panel.appendChild(cap);
  }

  function paintBar() {
    $("pg-android").setAttribute("aria-pressed", String(state.platform === "android"));
    $("pg-ios").setAttribute("aria-pressed", String(state.platform === "ios"));
    ["dark", "large", "rtl"].forEach(function (k) { $("pg-" + k).setAttribute("aria-pressed", String(state[k])); });
  }
  ["android", "ios"].forEach(function (p) { $("pg-" + p).addEventListener("click", function () { if (state.platform === p) return; state.platform = p; paintBar(); loadPhone(); }); });
  ["dark", "large", "rtl"].forEach(function (k) { $("pg-" + k).addEventListener("click", function () { state[k] = !state[k]; paintBar(); send(); }); });

  function show() {
    var id = location.hash.slice(1), f = features.filter(function (x) { return x.id === id; })[0] || features[0];
    Array.prototype.forEach.call(document.querySelectorAll("#pg-side a"), function (a) {
      if (a.getAttribute("data-feature") === f.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    var panel = $("pg-panel");
    panel.textContent = "";
    var h = document.createElement("h2"); h.textContent = f.title; panel.appendChild(h);
    var p = document.createElement("p"); p.textContent = f.text; panel.appendChild(p);
    if (f.doc) { var a = document.createElement("a"); a.className = "link"; a.href = f.doc; a.textContent = "Read the docs"; panel.appendChild(a); }
    if (f.id === "device") deviceControls(panel);
    if (f.id === "agent") agentPanel(panel);
    panel.setAttribute("data-feature", f.id);
  }
  window.addEventListener("hashchange", show);
  paintBar(); show(); loadPhone();
})();
