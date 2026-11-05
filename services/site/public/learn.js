// Learn hub: instant search and filters over /learn/index.json. State lives in the URL.
import { FACETS, searchIndex, facetCounts, parseState, toQuery, isActive } from "/learn-search.js";
const $ = (id) => document.getElementById(id);
const q = $("lq"), box = $("lresults"), stat = $("lstatic"), count = $("lcount"), clear = $("lclear");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LABEL = { tutorial: "Tutorial", video: "Video", glossary: "Glossary" };
let index = null, state = parseState(location.search);

function card(e) {
  const meta = [e.time && e.type !== "glossary" ? e.time : "", e.level ? e.level[0].toUpperCase() + e.level.slice(1) : ""].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join("");
  return `<a class="lcard${e.type === "video" ? " lvideo" : ""}" href="${esc(e.path)}"><span class="lgroup">${LABEL[e.type]}</span>${e.poster ? `<img src="${esc(e.poster)}" alt="" loading="lazy" width="640" height="360">` : ""}<b>${esc(e.title)}</b><span class="ldesc">${esc(e.desc)}</span>${meta ? `<span class="lmeta">${meta}</span>` : ""}</a>`;
}

function render(push) {
  const active = isActive(state);
  if (push) history.replaceState(null, "", location.pathname + toQuery(state));
  for (const fs of document.querySelectorAll(".lfilter")) {
    const k = fs.dataset.key, c = index ? facetCounts(index, state, k) : {};
    for (const b of fs.querySelectorAll(".chip")) {
      const on = state[k] === b.dataset.value;
      b.setAttribute("aria-pressed", on);
      b.querySelector(".n").textContent = index ? " " + (c[b.dataset.value] ?? 0) : "";
      b.disabled = !on && index && !c[b.dataset.value];
    }
  }
  clear.hidden = !active;
  stat.hidden = active; box.hidden = !active; count.hidden = !active;
  if (!active || !index) return;
  const rows = searchIndex(index, state);
  const what = [state.q && `“${state.q}”`].filter(Boolean).join("");
  if (!rows.length) {
    count.textContent = "No results" + (what ? " for " + what : "");
    box.innerHTML = `<div class="lempty"><b>No results${what ? " for " + esc(what) : ""}.</b><p>Try fewer or different words, such as “update” or “simulator”. Or <button type="button" class="link" id="lreset">clear the filters</button>.</p></div>`;
    $("lreset").onclick = reset;
  } else {
    count.textContent = `${rows.length} result${rows.length === 1 ? "" : "s"}${what ? " for " + what : ""}`;
    box.innerHTML = rows.map(card).join("");
  }
}
function reset() { state = { q: "", type: "", goal: "", level: "", time: "" }; q.value = ""; render(true); }

q.value = state.q;
render(false);
fetch("/learn/index.json").then((r) => r.json()).then((d) => { index = d; render(false); });
q.addEventListener("input", () => { state.q = q.value; render(true); });
q.addEventListener("keydown", (e) => {
  const as = [...box.querySelectorAll("a")], i = as.indexOf(document.activeElement);
  if (e.key === "ArrowDown" && as.length) { e.preventDefault(); as[0].focus(); }
  else if (e.key === "Enter" && as.length) { e.preventDefault(); as[0].click(); }
  else if (e.key === "Escape") { q.value = ""; state.q = ""; render(true); }
});
box.addEventListener("keydown", (e) => {
  const as = [...box.querySelectorAll("a")], i = as.indexOf(document.activeElement);
  if (i < 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  e.preventDefault();
  if (e.key === "ArrowUp" && i === 0) q.focus(); else as[Math.min(as.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
});
$("lfilters").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (b) { const k = b.closest(".lfilter").dataset.key; state[k] = state[k] === b.dataset.value ? "" : b.dataset.value; render(true); }
});
clear.addEventListener("click", reset);
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); q.focus(); }
});
