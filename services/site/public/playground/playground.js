// shipvo.dev/playground: one phone (Android or iOS), phone settings, and a feature sidebar with deep links (/playground/#ota).
(function () {
  var features = JSON.parse(document.getElementById("pg-features").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var phone = $("pg-phone"), state = { platform: "android", dark: false, large: false, rtl: false };
  var q = new URLSearchParams(location.search);
  if (q.get("platform") === "ios") state.platform = "ios";
  ["dark", "large", "rtl"].forEach(function (k) { if (q.get(k) === "1") state[k] = true; });

  var manyGrid = null;
  function sendMany() {
    if (!manyGrid) return;
    Array.prototype.forEach.call(manyGrid.querySelectorAll("iframe"), function (fr) { try { fr.contentWindow.postMessage({ type: "pg:prefs", dark: state.dark, large: state.large, rtl: state.rtl }, "*"); } catch (e) {} });
  }
  function send() { sendMany(); try { phone.contentWindow.postMessage({ type: "pg:prefs", dark: state.dark, large: state.large, rtl: state.rtl }, "*"); } catch (e) {} replay(); }
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
    var d = e.data; if (e.source !== phone.contentWindow || e.origin !== location.origin || !d || d.type !== "pg:tool:result" || !calls[d.id]) return;
    calls[d.id](d.result); delete calls[d.id];
  });
  function callTool(tool, args) {
    return new Promise(function (res) {
      var id = ++callId, t = setTimeout(function () { delete calls[id]; res({ error: "timeout" }); }, 15000);
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
    var out = document.createElement("pre"); out.id = "pg-out"; out.setAttribute("aria-label", "Tool result"); out.setAttribute("role", "status"); out.setAttribute("aria-live", "polite"); out.tabIndex = 0; out.textContent = "Pick a tool and run it.";
    form.addEventListener("submit", function (ev) {
      ev.preventDefault(); var args = {};
      Array.prototype.forEach.call(argBox.querySelectorAll("input"), function (i) { args[i.getAttribute("data-arg")] = i.value; });
      callTool(sel.value, args).then(function (r) { out.textContent = JSON.stringify(r, null, 2); });
    });
    form.appendChild(sel); form.appendChild(argBox); form.appendChild(run); panel.appendChild(form); panel.appendChild(out);
    var lumi = document.createElement("button"); lumi.type = "button"; lumi.id = "pg-lumi"; lumi.textContent = "Watch Lumi";
    var cap = document.createElement("ol"); cap.id = "pg-captions"; cap.setAttribute("aria-label", "Lumi captions"); cap.setAttribute("aria-live", "polite");
    var picks = ["Spinning rod", "Tackle box", "Tide chart"];
    function refFor(scr, item) {
      var els = (scr && scr.elements) || [];
      for (var i = 0; i < els.length; i++) if (els[i].name && els[i].name.indexOf("Add " + item) === 0) return els[i].ref;
      return null;
    }
    lumi.addEventListener("click", function () {
      lumi.disabled = true; cap.textContent = ""; lumi.removeAttribute("data-done");
      function say(t) { var li = document.createElement("li"); li.textContent = t; cap.appendChild(li); }
      function show(r) { out.textContent = JSON.stringify(r, null, 2); return new Promise(function (ok) { setTimeout(ok, 600); }); }
      say("Lumi reads the screen.");
      callTool("screen", {}).then(function (scr) {
        return show(scr).then(function () {
          return picks.reduce(function (p, item) {
            return p.then(function () {
              var ref = refFor(scr, item); if (!ref) return null;
              say("Lumi taps Add " + item + " to cart.");
              return callTool("tap", { ref: ref }).then(show);
            });
          }, Promise.resolve());
        });
      }).then(function () { lumi.disabled = false; lumi.setAttribute("data-done", "true"); });
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

  // Many phones: N frames of the same phone files, Android, iOS or alternating.
  var many = { count: 4, mix: "both" };
  if (q.has("phones")) { var qn = Math.round(Number(q.get("phones"))); many.count = qn >= 1 ? Math.min(12, qn) : (qn <= 0 ? 1 : 4); }
  if (q.get("mix") === "android" || q.get("mix") === "ios") many.mix = q.get("mix");
  function manyPanel(panel) {
    var ctl = document.createElement("div"); ctl.className = "pg-many-ctl";
    var l1 = document.createElement("label"); l1.textContent = "Phones";
    var num = document.createElement("input"); num.type = "number"; num.id = "pg-many-count"; num.min = "1"; num.max = "12"; num.step = "1"; num.value = String(many.count); l1.appendChild(num);
    var l2 = document.createElement("label"); l2.textContent = "Mix";
    var sel = document.createElement("select"); sel.id = "pg-many-mix";
    [["android", "Android"], ["ios", "iOS"], ["both", "Android and iOS"]].forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
    sel.value = many.mix; l2.appendChild(sel);
    var copy = document.createElement("button"); copy.type = "button"; copy.id = "pg-many-copy"; copy.textContent = "Copy link";
    var note = document.createElement("span"); note.id = "pg-many-copied"; note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite");
    ctl.appendChild(l1); ctl.appendChild(l2); ctl.appendChild(copy); ctl.appendChild(note); panel.appendChild(ctl);
    var grid = document.createElement("div"); grid.className = "pg-many"; grid.id = "pg-many-grid"; panel.appendChild(grid); manyGrid = grid;
    copy.addEventListener("click", function () {
      var u = new URL(location.href), sp = new URLSearchParams();
      sp.set("phones", String(many.count)); sp.set("mix", many.mix); if (state.dark) sp.set("dark", "1");
      u.search = "?" + sp.toString(); u.hash = "#many";
      history.replaceState(null, "", u.toString());
      var fail = function () { note.textContent = "Link is in the address bar."; };
      try { navigator.clipboard.writeText(u.toString()).then(function () { note.textContent = "Link copied."; }, fail); } catch (e) { fail(); }
    });
    function render() {
      var n = Math.round(Number(num.value));
      if (!(n >= 1)) return;
      n = Math.min(12, n); many.count = n; many.mix = sel.value;
      var want = [];
      for (var i = 0; i < n; i++) want.push(many.mix === "both" ? (i % 2 ? "ios" : "android") : many.mix);
      grid.textContent = "";
      want.forEach(function (pl, i) {
        var fr = document.createElement("iframe");
        fr.setAttribute("data-platform", pl);
        fr.title = (pl === "ios" ? "iOS" : "Android") + " phone " + (i + 1);
        fr.src = phone.getAttribute("data-src-" + pl);
        fr.addEventListener("load", function () { sendMany(); setTimeout(sendMany, 300); });
        grid.appendChild(fr);
      });
    }
    num.addEventListener("input", render); num.addEventListener("change", function () { render(); num.value = String(many.count); });
    sel.addEventListener("change", render);
    render();
  }

  function show() {
    var id = location.hash.slice(1), f = features.filter(function (x) { return x.id === id; })[0] || features[0];
    Array.prototype.forEach.call(document.querySelectorAll("#pg-side a"), function (a) {
      if (a.getAttribute("data-feature") === f.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    var panel = $("pg-panel"); manyGrid = null;
    panel.textContent = "";
    var h = document.createElement("h2"); h.textContent = f.title; panel.appendChild(h);
    var p = document.createElement("p"); p.textContent = f.text; panel.appendChild(p);
    if (f.id === "ota") otaPanel(panel);
    if (f.doc) { var a = document.createElement("a"); a.className = "link"; a.href = f.doc; a.textContent = "Read the docs"; panel.appendChild(a); }
    if (f.id === "device") deviceControls(panel);
    if (f.id === "agent") agentPanel(panel);
    if (f.id === "many") manyPanel(panel);
    phone.style.display = f.id === "many" ? "none" : "";
    panel.setAttribute("data-feature", f.id);
  }
  // OTA walkthrough. Every number comes from /playground/ota-run.json, which the site build records from the real signer,
  // verifier, cohort bands and the runtime's crash-loop threshold.
  var ota = { version: 1, step: 0, log: [] }, otaRun = null;
  function setVersion(v) { ota.version = v; try { phone.contentWindow.postMessage({ type: "pg:ota", version: v }, "*"); } catch (e) {} }
  phone.addEventListener("load", function () { setVersion(ota.version); });
  function otaPanel(panel) {
    var steps = [["pub", "Publish update"], ["stage", "Stage to 10%"], ["widen", "Widen to 100%"], ["crash", "Crash the update"], ["rollback", "Watch rollback"]];
    var row = document.createElement("div"); row.className = "pg-steps"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Update steps");
    var out = document.createElement("ol"); out.className = "pg-log"; out.setAttribute("data-testid", "ota-log"); out.setAttribute("role", "log"); out.setAttribute("aria-live", "polite"); out.setAttribute("aria-label", "Update log");
    var status = document.createElement("p"); status.setAttribute("data-testid", "ota-status"); status.setAttribute("aria-live", "polite");
    function line(t) { ota.log.push(t); }
    function paint() {
      Array.prototype.forEach.call(row.children, function (b, i) { b.disabled = b.getAttribute("data-step") === "reset" ? false : (!otaRun || i !== ota.step); });
      out.textContent = ""; ota.log.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; out.appendChild(li); });
      status.textContent = !otaRun ? "Loading the recorded run." : "Phone runs version " + ota.version + ". " + (ota.step < steps.length ? "Next: " + steps[ota.step][1] + "." : "All steps done. Press Start over to run it again.");
      panel.setAttribute("data-ota-step", String(ota.step));
    }
    var actions = {
      pub: function () {
        var g = otaRun.signature; setVersion(2);
        line("Published release 2 (version 2) to the first cohort. A cohort is a slice of your users that gets an update before everyone else.");
        line("Signature check: " + (g.valid ? "valid" : "invalid") + " (" + g.algorithm + ", verifier output). Same release with one field changed: " + (g.tamperedValid ? "valid" : "rejected") + ".");
        line("Public key: " + g.publicKey);
      },
      stage: function () { var s = otaRun.stages[0]; line("Staged to " + s.percent + "% (band " + s.band + "): " + s.cohorts + " of " + s.of + " cohorts receive version 2."); },
      widen: function () { var s = otaRun.stages[1]; line("Widened to " + s.percent + "% (band " + s.band + "): " + s.cohorts + " of " + s.of + " cohorts receive version 2."); },
      crash: function () {
        otaRun.boots.filter(function (b) { return b.crashed; }).forEach(function (b) { line("Start " + b.start + ": version 2 crashed. Trial starts counted: " + b.trialBoots + " of " + otaRun.maxBoots + "."); });
        line("The runtime allows " + otaRun.maxBoots + " crashing starts of a new release (read from " + otaRun.source.join(" and ") + ").");
      },
      rollback: function () {
        var b = otaRun.boots[otaRun.boots.length - 1]; setVersion(1);
        line("Start " + b.start + ": " + otaRun.maxBoots + " trial starts used, so the runtime reports " + b.event + " and loads version 1.");
      },
    };
    steps.forEach(function (st, i) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("data-step", st[0]); b.textContent = st[1];
      b.addEventListener("click", function () { if (!otaRun || ota.step !== i) return; actions[st[0]](); ota.step = i + 1; paint(); });
      row.appendChild(b);
    });
    var reset = document.createElement("button"); reset.type = "button"; reset.className = "pg-reset"; reset.setAttribute("data-step", "reset"); reset.textContent = "Start over";
    reset.addEventListener("click", function () { ota.step = 0; ota.log = []; setVersion(1); paint(); });
    row.appendChild(reset);
    panel.appendChild(row); panel.appendChild(status); panel.appendChild(out);
    if (otaRun) paint(); else { paint(); fetch("/playground/ota-run.json").then(function (r) { return r.json(); }).then(function (j) { otaRun = j; if (panel.getAttribute("data-feature") === "ota") { show(); } }); }
  }
  window.addEventListener("hashchange", show);
  paintBar(); show(); loadPhone();
})();
