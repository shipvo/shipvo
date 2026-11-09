// shipvo.dev/playground: one phone (Android or iOS), phone settings, and a feature sidebar with deep links (/playground/#ota).
(function () {
  var features = JSON.parse(document.getElementById("pg-features").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var phone = $("pg-phone"), state = { platform: "android", dark: false, large: false, rtl: false };
  var q = new URLSearchParams(location.search);
  if (q.get("platform") === "ios") state.platform = "ios";
  ["dark", "large", "rtl"].forEach(function (k) { if (q.get(k) === "1") state[k] = true; });

  function send() { try { phone.contentWindow.postMessage({ type: "pg:prefs", dark: state.dark, large: state.large, rtl: state.rtl }, "*"); } catch (e) {} }
  function loadPhone() { phone.title = state.platform === "ios" ? "iOS phone" : "Android phone"; phone.src = phone.getAttribute("data-src-" + state.platform); }
  phone.addEventListener("load", function () { send(); setTimeout(send, 300); });
  window.addEventListener("message", function (e) { if (e.source === phone.contentWindow && e.data && e.data.type === "pg:ready") send(); });

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
    if (f.id === "ota") otaPanel(panel);
    if (f.doc) { var a = document.createElement("a"); a.className = "link"; a.href = f.doc; a.textContent = "Read the docs"; panel.appendChild(a); }
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
