// In-page search for long lists (blog, changelog, roadmap). Markup:
// <input type="search" data-filter="#scope" data-items=".item" data-groups=".group" data-count="#count">
// Every word must appear in an item. Groups with no match hide; <details> holding a match open. "/" focuses the box.
(() => {
  const boxes = [...document.querySelectorAll("input[data-filter]")];
  if (!boxes.length) return;
  for (const box of boxes) {
    const scope = document.querySelector(box.dataset.filter);
    if (!scope) continue;
    const items = [...scope.querySelectorAll(box.dataset.items)];
    const groups = box.dataset.groups ? [...scope.querySelectorAll(box.dataset.groups)] : [];
    const count = box.dataset.count && document.querySelector(box.dataset.count);
    const empty = (scope.closest("section, main") || document).querySelector("[data-filter-empty]");
    const text = new Map(items.map((el) => [el, `${el.dataset.area ?? ""} ${el.textContent}`.toLowerCase().replace(/\s+/g, " ")]));
    const opened = new Set();
    const run = () => {
      const words = box.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      let n = 0;
      for (const el of items) {
        const hit = words.every((w) => text.get(el).includes(w));
        el.classList.toggle("f-out", !hit);
        if (hit) n++;
      }
      for (const g of groups) {
        const any = [...g.querySelectorAll(box.dataset.items)].some((el) => !el.classList.contains("f-out"));
        g.classList.toggle("f-out", words.length > 0 && !any);
      }
      for (const d of scope.querySelectorAll("details")) {
        const has = words.length && [...d.querySelectorAll(box.dataset.items)].some((el) => !el.classList.contains("f-out"));
        if (has && !d.open) { d.open = true; opened.add(d); }
        else if (!words.length && opened.has(d)) { d.open = false; opened.delete(d); }
      }
      if (count) count.textContent = words.length ? `${n} result${n === 1 ? "" : "s"}` : "";
      if (empty) empty.hidden = !(words.length && n === 0);
    };
    box.addEventListener("input", run);
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { box.value = ""; run(); } });
    const q = new URLSearchParams(location.search).get("q");
    if (q) { box.value = q; run(); }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
    e.preventDefault(); boxes[0].focus();
  });
})();
