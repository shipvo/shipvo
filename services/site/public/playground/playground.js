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
    panel.setAttribute("data-feature", f.id);
  }
  window.addEventListener("hashchange", show);
  paintBar(); show(); loadPhone();
})();
