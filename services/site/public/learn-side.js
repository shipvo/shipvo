// Learn sidebar: the box filters the menu as you type. "/" focuses it.
(function () {
  var inp = document.getElementById("sidefilter"), none = document.getElementById("side-empty"); if (!inp) return;
  var groups = [].slice.call(document.querySelectorAll("#side .side-group"));
  function run() {
    var q = inp.value.trim().toLowerCase(), shown = 0;
    groups.forEach(function (g) {
      var n = 0;
      [].slice.call(g.querySelectorAll("a")).forEach(function (a) { var ok = !q || a.textContent.toLowerCase().indexOf(q) >= 0; a.hidden = !ok; if (ok) n++; });
      g.hidden = !n; shown += n;
    });
    none.hidden = !!shown;
  }
  inp.addEventListener("input", run);
  inp.addEventListener("keydown", function (e) { if (e.key === "Escape") { inp.value = ""; run(); inp.blur(); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); inp.focus(); }
  });
  var cur = document.querySelector('#side a[aria-current="page"]'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
})();
