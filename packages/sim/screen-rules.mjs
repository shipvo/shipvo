// The rules that decide what is "on screen" for an agent. Plain ES module, no imports, so the simulator
// (`server.mjs`) and the `shipvo run` frame page share one copy. The DOM functions are self-contained:
// they call no other function, so they can be serialised and run inside a page with `(${fn})(document)`.

/** Remove the markers that `applyScreenRules` set. */
export function clearScreenRules(document) {
  for (const el of document.querySelectorAll("[data-pn-offscreen]")) { el.removeAttribute("aria-hidden"); el.removeAttribute("data-pn-offscreen"); }
}

/** Call `clearScreenRules` first. Hide what a phone would not expose: content behind a modal sheet and off-screen items of a horizontal list. */
export function applyScreenRules(document) {
  const win = document.defaultView;
  // A modal sheet (accessibilityViewIsModal / aria-modal) hides everything behind it from assistive tech on phones.
  const modal = [...document.querySelectorAll('[aria-modal="true"]')].pop();
  if (modal) for (let node = modal; node && node !== document.body; node = node.parentElement)
    for (const sib of node.parentElement?.children ?? []) if (sib !== node && !sib.hasAttribute("aria-hidden")) { sib.setAttribute("aria-hidden", "true"); sib.setAttribute("data-pn-offscreen", "1"); }
  // Phones only expose the items of a horizontal list that are on screen.
  for (const sc of document.querySelectorAll("div")) {
    const cs = win.getComputedStyle(sc);
    if (!/(auto|scroll)/.test(cs.overflowX) || sc.scrollWidth <= sc.clientWidth + 1) continue;
    const box = sc.getBoundingClientRect();
    const row = sc.firstElementChild; if (!row) continue;
    for (const item of row.children) {
      const r = item.getBoundingClientRect();
      if (r.right <= box.left + 1 || r.left >= box.right - 1) { item.setAttribute("aria-hidden", "true"); item.setAttribute("data-pn-offscreen", "1"); }
    }
  }
}

/** Post-process an accessibility snapshot: drop empty generic lines, `aria-hidden` subtrees and the inner text of labelled controls. */
export function filterTree(tree) {
  const lines = tree.split("\n").filter((l) => !/^\s*- generic \[ref=e\d+\]:?\s*$/.test(l));
  // A screen reader announces a control's label, not the words inside it (Android and iOS group a pressable's
  // children into one element). Drop the inner text lines of labelled controls, as the phones do.
  const out = []; let hideBelow = -1;
  for (const l of lines) {
    const indent = l.search(/\S/);
    if (hideBelow >= 0 && indent > hideBelow) continue;
    hideBelow = -1;
    if (/\[aria-hidden\]/.test(l)) { hideBelow = indent; continue; }   // hidden from assistive tech: not on screen
    out.push(l);
    // The snapshot YAML-quotes a line whose label has ": " in it: single-quoted (`- 'button "Notification: ..." [ref=e1]':`,
    // a `'` in the label is doubled) or double-quoted when the label also has a `"` (`- "button \"A: b\" [ref=e1]":`).
    if (/^\s*- ['"]?(button|radio|link|checkbox|switch|tab) \\?"[^"]+/.test(l) && /:\s*$/.test(l)) hideBelow = indent;
  }
  return out.join("\n");
}
