// shipvo.dev/playground: one phone (Android or iOS), phone settings, and a feature sidebar with deep links (/playground/#ota).
(function () {
  var features = JSON.parse(document.getElementById("pg-features").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var phone = $("pg-phone"), state = { platform: "android", dark: false, large: false, rtl: false };
  var q = new URLSearchParams(location.search);
  if (q.get("platform") === "ios") state.platform = "ios";
  ["dark", "large", "rtl"].forEach(function (k) { if (q.get(k) === "1") state[k] = true; });

  function send() { try { phone.contentWindow.postMessage({ type: "pg:prefs", dark: state.dark, large: state.large, rtl: state.rtl }, "*"); } catch (e) {} replay(); }
  function loadPhone() { if (phone.hidden) return; phone.title = state.platform === "ios" ? "iOS phone" : "Android phone"; phone.src = phone.getAttribute("data-src-" + state.platform); }
  phone.addEventListener("load", function () { send(); setTimeout(send, 300); });
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "pg:ready") return;
    if (e.source === phone.contentWindow) send();
    else if (gridFrames().some(function (f) { return f.contentWindow === e.source; })) sendMany();
  });

  // Many phones: count, platform mix and prefs live in the URL (?phones=6&mix=both&dark=1), read on load.
  var many = { phones: 4, mix: "both" }, MAX_PHONES = 12;
  var qp = parseInt(q.get("phones"), 10);
  if (qp >= 1) many.phones = Math.min(MAX_PHONES, qp);
  if (["android", "ios", "both"].indexOf(q.get("mix")) >= 0) many.mix = q.get("mix");
  function gridFrames() { var g = $("pg-grid"); return g ? Array.prototype.slice.call(g.querySelectorAll("iframe")) : []; }
  function sendMany() {
    gridFrames().forEach(function (f) { try { f.contentWindow.postMessage({ type: "pg:prefs", dark: state.dark, large: state.large, rtl: state.rtl }, "*"); } catch (e) {} });
  }
  function platformAt(i) { return many.mix === "both" ? (i % 2 === 0 ? "android" : "ios") : many.mix; }
  function shareLink() {
    var p = new URLSearchParams();
    p.set("phones", String(many.phones)); p.set("mix", many.mix);
    ["dark", "large", "rtl"].forEach(function (k) { if (state[k]) p.set(k, "1"); });
    return location.origin + location.pathname + "?" + p.toString() + "#many";
  }
  function manyPanel(panel) {
    var bar = document.createElement("div"); bar.className = "pg-many";
    var lab = document.createElement("label"); lab.textContent = "Phones ";
    var num = document.createElement("input"); num.type = "number"; num.id = "pg-count"; num.min = "1"; num.max = String(MAX_PHONES); num.value = String(many.phones);
    lab.appendChild(num); bar.appendChild(lab);
    var mixes = document.createElement("div"); mixes.setAttribute("role", "group"); mixes.setAttribute("aria-label", "Platform mix"); mixes.className = "pg-mix";
    [["android", "Android"], ["ios", "iOS"], ["both", "Both"]].forEach(function (m) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("data-mix", m[0]); b.textContent = m[1];
      b.setAttribute("aria-pressed", String(many.mix === m[0]));
      b.addEventListener("click", function () {
        if (many.mix === m[0]) return; many.mix = m[0];
        Array.prototype.forEach.call(mixes.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        renderGrid();
      });
      mixes.appendChild(b);
    });
    bar.appendChild(mixes);
    var copy = document.createElement("button"); copy.type = "button"; copy.id = "pg-copy"; copy.className = "pg-copy"; copy.textContent = "Copy link";
    var link = document.createElement("input"); link.type = "text"; link.readOnly = true; link.id = "pg-link"; link.hidden = true; link.setAttribute("aria-label", "Shareable link");
    var note = document.createElement("span"); note.setAttribute("role", "status"); note.id = "pg-copied";
    copy.addEventListener("click", function () {
      var url = shareLink(); link.value = url; link.hidden = false;
      var done = function (ok) { note.textContent = ok ? "Link copied." : "Copy the link from the box."; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done(true); }, function () { link.select(); done(false); });
      else { link.select(); done(false); }
    });
    num.addEventListener("input", function () {
      var n = parseInt(num.value, 10);
      if (!(n >= 1)) return;
      many.phones = Math.min(MAX_PHONES, n); renderGrid();
    });
    num.addEventListener("change", function () { num.value = String(many.phones); });
    bar.appendChild(copy); panel.appendChild(bar); panel.appendChild(link); panel.appendChild(note);
  }
  function renderGrid() {
    var g = $("pg-grid"), want = [], i;
    for (i = 0; i < many.phones; i++) want.push(platformAt(i));
    var cells = Array.prototype.slice.call(g.children);
    want.forEach(function (pl, i) {
      var cell = cells[i], f = cell && cell.querySelector("iframe");
      if (cell && f.getAttribute("data-platform") === pl) return;
      var nc = document.createElement("figure"); nc.className = "pg-cell";
      var cap = document.createElement("figcaption"); cap.textContent = (pl === "ios" ? "iOS" : "Android") + " phone " + (i + 1);
      var fr = document.createElement("iframe"); fr.className = "pg-phone"; fr.setAttribute("data-platform", pl); fr.title = cap.textContent;
      fr.addEventListener("load", function () { sendMany(); setTimeout(sendMany, 300); });
      fr.src = "/playground/phone-" + pl + ".html";
      nc.appendChild(cap); nc.appendChild(fr);
      if (cell) g.replaceChild(nc, cell); else g.appendChild(nc);
    });
    while (g.children.length > want.length) g.removeChild(g.lastChild);
    g.setAttribute("data-count", String(want.length));
  }

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

  function paintBar() {
    $("pg-android").setAttribute("aria-pressed", String(state.platform === "android"));
    $("pg-ios").setAttribute("aria-pressed", String(state.platform === "ios"));
    ["dark", "large", "rtl"].forEach(function (k) { $("pg-" + k).setAttribute("aria-pressed", String(state[k])); });
  }
  ["android", "ios"].forEach(function (p) { $("pg-" + p).addEventListener("click", function () { if (state.platform === p) return; state.platform = p; paintBar(); loadPhone(); }); });
  ["dark", "large", "rtl"].forEach(function (k) { $("pg-" + k).addEventListener("click", function () { state[k] = !state[k]; paintBar(); send(); sendMany(); }); });

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
    if (f.id === "device") deviceControls(panel);
    if (f.id === "many") manyPanel(panel);
    var grid = $("pg-grid"), isMany = f.id === "many";
    grid.hidden = !isMany; phone.hidden = isMany;
    if (isMany) renderGrid(); else if (!phone.getAttribute("src")) loadPhone();
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
  paintBar(); show();
})();
