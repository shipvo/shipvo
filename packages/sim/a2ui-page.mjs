// The page of an A2UI session: it shows the session's surfaces as the engine in a2ui.mjs draws them, sends what the person
// does (typing, ticks, taps, tabs, dialogs) to the simulator, and redraws when the agent sends more messages.

const CSS = `*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.a-surface{display:flex;flex-direction:column;gap:12px;padding:16px}
.a-col{display:flex;flex-direction:column;gap:12px;min-width:0}.a-row{display:flex;flex-direction:row;gap:12px;min-width:0;flex-wrap:wrap}
.a-text{margin:0}.a-body{font-size:16px}.a-caption{font-size:13px;color:#5f6368}
.a-card{border:1px solid #dadce0;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.a-list{list-style:none;margin:0;padding:0;display:flex;gap:10px}.a-list-v{flex-direction:column}.a-list-h{flex-direction:row;overflow-x:auto}
.a-div{border:0;background:#dadce0}.a-div-h{height:1px;width:100%}.a-div-v{width:1px;align-self:stretch}
.a-img{max-width:100%;border-radius:10px}.a-img-icon{width:24px;height:24px}.a-img-avatar{width:40px;height:40px;border-radius:50%}.a-img-smallFeature{width:80px;height:80px}.a-img-mediumFeature{width:100%;height:160px}.a-img-largeFeature{width:100%;height:240px}.a-img-header{width:100%;height:120px;border-radius:0}
.a-icon{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center}.a-media{width:100%}
.a-btn{font:600 16px system-ui,sans-serif;min-height:44px;padding:10px 16px;border-radius:10px;border:1px solid #dadce0;background:#f1f3f4;color:#111;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.a-btn-primary{background:#1a56db;border-color:#1a56db;color:#fff}.a-btn-primary .a-text{color:#fff}.a-btn-borderless{background:transparent;border-color:transparent;color:#1a56db}.a-btn[disabled]{opacity:.45}
.a-field{display:flex;flex-direction:column;gap:6px}.a-field label{display:flex;flex-direction:column;gap:6px;font-size:14px;color:#3c4043}.a-input{font:16px system-ui,sans-serif;min-height:44px;padding:10px 12px;border:1px solid #9aa0a6;border-radius:10px;width:100%;color:#111;background:#fff}textarea.a-input{min-height:96px}
.a-check,.a-opt{display:flex;align-items:center;gap:10px;min-height:44px}.a-check input,.a-opt input{width:20px;height:20px}
.a-pick{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.a-pick legend{font-size:14px;color:#3c4043;padding:0;margin-bottom:4px}.a-opt-chip{display:inline-flex;border:1px solid #dadce0;border-radius:999px;padding:0 12px}
.a-err{color:#b3261e;font-size:13px}
.a-tabs [role=tablist]{display:flex;gap:4px;border-bottom:1px solid #dadce0}.a-tabs [role=tab]{font:600 15px system-ui,sans-serif;min-height:44px;padding:8px 14px;border:0;background:none;color:#5f6368;border-bottom:2px solid transparent}.a-tabs [role=tab][aria-selected=true]{color:#1a56db;border-bottom-color:#1a56db}.a-tabs [role=tabpanel]{padding-top:12px}
.a-modal{position:fixed;inset:0;background:#0007;display:flex;align-items:flex-end;z-index:10}.a-sheet{background:#fff;width:100%;border-radius:18px 18px 0 0;padding:18px;display:flex;flex-direction:column;gap:12px;max-height:85%;overflow:auto}.a-modal-trigger{display:inline-flex}
.a-stat{display:flex;flex-direction:column;gap:2px}.a-stat strong{font-size:28px}.a-stat em{font-style:normal;font-size:14px;color:#137333}
.a-badge{display:inline-flex;align-self:flex-start;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;background:#e8eaed;color:#3c4043}.a-tone-success{background:#e6f4ea;color:#137333}.a-tone-warning{background:#fef7e0;color:#b06000}.a-tone-danger{background:#fce8e6;color:#b3261e}
.a-progress{height:8px;border-radius:4px;background:#e8eaed;overflow:hidden}.a-progress i{display:block;height:100%;background:#1a56db}
.a-wait{display:none}.a-empty{padding:24px 16px;color:#5f6368}`;

// Runs in the page. `base` is /a2ui/<session>.
const CLIENT = (base) => {
  const root = document.getElementById("a2ui"); let rev = -1, busy = false;
  const post = (o) => fetch(base + "/op", { method: "POST", body: JSON.stringify(o) }).then((r) => r.json()).catch(() => ({}));
  const keyOf = (el) => (el && el.dataset && el.dataset.id ? el.dataset.surface + "|" + el.dataset.id + "|" + el.dataset.scope + "|" + (el.value && (el.type === "radio" || el.type === "checkbox") ? el.value : "") : null);
  async function refresh(force) {
    if (busy) return; busy = true;
    try {
      const j = await (await fetch(base + "/html?rev=" + (force ? -1 : rev))).json();
      if (j.html !== undefined) {
        // Keep the control the person is in, and their caret, across the redraw.
        const a = document.activeElement, key = keyOf(a), start = a && a.selectionStart, end = a && a.selectionEnd;
        root.innerHTML = j.html || '<p class="a-empty">No surface yet.</p>'; rev = j.rev; window.__a2uiRev = rev;
        if (key) for (const el of root.querySelectorAll("[data-id]")) if (keyOf(el) === key) { el.focus({ preventScroll: true }); try { if (start != null && el.setSelectionRange) el.setSelectionRange(start, end); } catch (e) {} break; }
      }
    } catch (e) {} finally { busy = false; }
  }
  const send = async (o) => { await post(o); await refresh(true); };
  const valueOf = (el) => {
    const kind = el.dataset.input;
    if (kind === "bool") return el.checked;
    if (kind === "number") return el.value === "" ? "" : Number(el.value);
    if (kind === "one") return [el.value];
    if (kind === "many") return [...root.querySelectorAll('input[name="' + CSS.escape(el.name) + '"]:checked')].map((x) => x.value);
    return el.value;
  };
  const onInput = (e) => { const el = e.target; if (el && el.dataset && el.dataset.bind) send({ kind: "input", surfaceId: el.dataset.surface, path: el.dataset.bind, value: valueOf(el) }); };
  root.addEventListener("input", (e) => { if (e.target.type !== "checkbox" && e.target.type !== "radio") onInput(e); });
  root.addEventListener("change", (e) => { if (e.target.type === "checkbox" || e.target.type === "radio") onInput(e); });
  root.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : e.target.parentElement; if (!t) return;
    const tab = t.closest("[data-tab]"); if (tab) return void send({ kind: "tab", surfaceId: tab.dataset.surface, id: tab.dataset.id, index: Number(tab.dataset.tab) });
    const press = t.closest("[data-press]"); if (press) { if (!press.disabled) send({ kind: "press", surfaceId: press.dataset.surface, id: press.dataset.id, scope: press.dataset.scope }); return; }
    const modal = t.closest("[data-modal]"); if (modal) send({ kind: "modal", surfaceId: modal.dataset.surface, id: modal.dataset.id, open: modal.dataset.modal === "open" });
  });
  refresh(true); setInterval(() => { if (!document.hidden) refresh(false); }, 250);
};

/** The page for the A2UI session `session`. */
export function a2uiPage(session) {
  const base = `/a2ui/${encodeURIComponent(session)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A2UI</title><style>${CSS}</style></head>`
    + `<body><div id="a2ui"></div><script>(${CLIENT.toString()})(${JSON.stringify(base)})</script></body></html>`;
}
