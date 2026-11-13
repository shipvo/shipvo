// A2UI on Shipvo Phone. Reads A2UI v1.0 messages (createSurface, updateComponents, updateDataModel, deleteSurface,
// callRendererFunction), keeps each surface's components and data model, draws the surface as accessible HTML for the
// phone, and turns what the person does into A2UI messages for the agent (action, error, rendererFunctionResponse).
// The agent sends data, never code: only components and functions of a known catalog are drawn or run.

export const VERSION = "1.0";
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
export const SHIPVO_CATALOG_ID = "https://shipvo.dev/a2ui/catalogs/phone/v1/catalog.json";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- The data model: JSON Pointers (RFC 6901) ----

/** The segments of a JSON Pointer. "" and "/" are the root. */
export const pointerParts = (path) => (path === "" || path === "/" ? [] : String(path).replace(/^\//, "").split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~")));
const toPointer = (parts) => "/" + parts.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

export function getAt(data, path) {
  let cur = data;
  for (const p of pointerParts(path)) { if (cur === null || typeof cur !== "object") return undefined; cur = cur[p]; }
  return cur;
}

/** Sets `value` at `path`, creating objects on the way. null removes the key. Returns the new root. */
export function setAt(data, path, value) {
  const parts = pointerParts(path);
  if (!parts.length) return value === null ? {} : value;
  const root = isObj(data) || Array.isArray(data) ? data : {};
  let cur = root;
  for (const p of parts.slice(0, -1)) { if (cur[p] === null || typeof cur[p] !== "object") cur[p] = {}; cur = cur[p]; }
  const last = parts[parts.length - 1];
  if (value === null) { if (Array.isArray(cur)) cur.splice(Number(last), 1); else delete cur[last]; } else cur[last] = value;
  return root;
}

/** The absolute pointer a binding names: "/a/b" as it is, "name" under the template scope it is used in. */
export const absPath = (path, scope) => (String(path).startsWith("/") ? String(path) : toPointer([...pointerParts(scope || "/"), ...pointerParts("/" + path)]));

// ---- Functions an agent may name. requiresUserActivation: runs only from a person's tap, never from the agent or a binding. ----

const num = (v) => (typeof v === "number" ? v : Number(v));
export const FUNCTIONS = {
  required: { returnType: "validationResult", run: (a) => !(a.value === undefined || a.value === null || a.value === "" || (Array.isArray(a.value) && !a.value.length)) },
  regex: { returnType: "validationResult", run: (a) => { try { return String(a.pattern ?? "").length <= 200 && new RegExp(String(a.pattern ?? "")).test(String(a.value ?? "")); } catch { return false; } } },
  length: { returnType: "validationResult", run: (a) => { const n = String(a.value ?? "").length; return (a.min === undefined || n >= num(a.min)) && (a.max === undefined || n <= num(a.max)); } },
  numeric: { returnType: "validationResult", run: (a) => { const n = num(a.value); return a.value !== "" && a.value != null && Number.isFinite(n) && (a.min === undefined || n >= num(a.min)) && (a.max === undefined || n <= num(a.max)); } },
  email: { returnType: "validationResult", run: (a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(a.value ?? "")) },
  and: { returnType: "boolean", run: (a) => (Array.isArray(a.values) ? a.values : []).every(Boolean) },
  or: { returnType: "boolean", run: (a) => (Array.isArray(a.values) ? a.values : []).some(Boolean) },
  not: { returnType: "boolean", run: (a) => !a.value },
  formatString: { returnType: "string", run: (a, ctx) => String(a.value ?? "").replace(/\$\{([^}]*)\}/g, (_, p) => { const v = ctx.read(p.trim()); return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }) },
  formatNumber: { returnType: "string", run: (a) => (Number.isFinite(num(a.value)) ? num(a.value).toLocaleString("en-US", a.decimals === undefined ? {} : { minimumFractionDigits: num(a.decimals), maximumFractionDigits: num(a.decimals) }) : "") },
  formatCurrency: { returnType: "string", run: (a) => { try { return num(a.value).toLocaleString("en-US", { style: "currency", currency: String(a.currency ?? "USD") }); } catch { return String(a.value ?? ""); } } },
  formatDate: { returnType: "string", run: (a) => { const d = new Date(String(a.value ?? "")); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); } },
  pluralize: { returnType: "string", run: (a) => { const n = num(a.value ?? a.count); return String(n === 1 ? a.one ?? "" : a.other ?? a.one ?? ""); } },
  openUrl: { returnType: "void", requiresUserActivation: true, run: (a, ctx) => { ctx.effect({ openUrl: String(a.url ?? "") }); } },
};

// ---- Components: the A2UI basic catalog, plus Shipvo's own. `req` are the properties a component must carry. ----

const BASIC = {
  Text: ["text"], Image: ["url"], Icon: ["name"], Video: ["url"], AudioPlayer: ["url"], Row: ["children"], Column: ["children"], List: ["children"],
  Card: ["child"], Tabs: ["tabs"], Modal: ["trigger", "content"], Divider: [], Button: ["child", "action"], TextField: ["label", "value"],
  CheckBox: ["label", "value"], ChoicePicker: ["options", "value"], Slider: ["value", "max"], DateTimeInput: ["value"],
};
/** Shipvo's phone catalog: display blocks from the Shipvo app spec, usable in an A2UI surface with "@catalogId". */
export const SHIPVO_COMPONENTS = {
  Stat: { req: ["label", "value"], description: "One number with its label, and an optional change such as +12%.", properties: { label: "DynamicString", value: "DynamicString", delta: "DynamicString" } },
  Badge: { req: ["text"], description: "A short status word. tone is neutral, success, warning or danger.", properties: { text: "DynamicString", tone: { enum: ["neutral", "success", "warning", "danger"] } } },
  Progress: { req: ["value"], description: "How far along something is: value out of max (default 100).", properties: { label: "DynamicString", value: "DynamicNumber", max: { type: "number" } } },
};
const REQUIRED = { ...BASIC, ...Object.fromEntries(Object.entries(SHIPVO_COMPONENTS).map(([k, v]) => [k, v.req])) };
export const COMPONENTS = Object.keys(REQUIRED);

/** The Shipvo phone catalog as an A2UI catalog document. */
export function catalogDocument() {
  const dyn = (t) => (typeof t === "string" ? { $ref: `https://a2ui.org/specification/v1_0/json/common_types.json#/$defs/${t}` } : t);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", $id: SHIPVO_CATALOG_ID, protocolVersion: VERSION, title: "Shipvo Phone catalog",
    description: "Components Shipvo Phone draws in an A2UI surface in addition to the A2UI basic catalog.", catalogId: SHIPVO_CATALOG_ID,
    instructions: "Use these with \"@catalogId\" on the component, inside a surface that uses the A2UI basic catalog. Stat shows one number, Badge one status word, Progress a share of a whole.",
    components: Object.fromEntries(Object.entries(SHIPVO_COMPONENTS).map(([name, c]) => [name, {
      type: "object", description: c.description, additionalProperties: false, required: ["id", "component", ...c.req],
      properties: { id: { type: "string" }, component: { const: name }, "@catalogId": { type: "string" }, ...Object.fromEntries(Object.entries(c.properties).map(([k, t]) => [k, dyn(t)])) },
    }])),
    functions: {},
    $defs: { anyComponent: { oneOf: Object.keys(SHIPVO_COMPONENTS).map((n) => ({ $ref: `#/components/${n}` })) } },
  };
}

// ---- The surfaces ----

export function createA2ui({ now = () => new Date() } = {}) {
  const surfaces = new Map();
  /** Messages for the agent, oldest first: action, error, rendererFunctionResponse. */
  const outbox = [];
  /** Things a function did on the phone, for example { openUrl }. */
  const effects = [];
  let rev = 0;
  const fail = (code, message, extra = {}) => { const m = { version: VERSION, error: { code, message, ...extra } }; outbox.push(m); return m; };

  function checkComponents(list, surfaceId) {
    if (!Array.isArray(list) || !list.length) return fail("VALIDATION_FAILED", "components must be a list with at least one component", { surfaceId, path: "/components" });
    for (const [i, c] of list.entries()) {
      const at = `/components/${i}`;
      if (!isObj(c) || typeof c.id !== "string" || !c.id) return fail("VALIDATION_FAILED", "a component needs an id", { surfaceId, path: `${at}/id` });
      if (!Object.prototype.hasOwnProperty.call(REQUIRED, c.component)) return fail("VALIDATION_FAILED", `"${String(c.component).slice(0, 40)}" is not a component of the catalog`, { surfaceId, path: `${at}/component` });
      const missing = REQUIRED[c.component].find((k) => c[k] === undefined);
      if (missing) return fail("VALIDATION_FAILED", `${c.component} "${c.id}" needs "${missing}"`, { surfaceId, path: `${at}/${missing}` });
    }
    return null;
  }

  /** Applies one agent message. Returns { ok: true } or { ok: false, error } where error is the A2UI error message. */
  function apply(msg) {
    if (!isObj(msg) || msg.version !== VERSION) return { ok: false, error: fail("INVALID_MESSAGE", `a message needs "version": "${VERSION}"`, {}) };
    const keys = Object.keys(msg).filter((k) => k !== "version");
    if (keys.length !== 1) return { ok: false, error: fail("INVALID_MESSAGE", "a message carries exactly one of createSurface, updateComponents, updateDataModel, deleteSurface, callRendererFunction", {}) };
    const [kind] = keys, body = msg[kind];
    if (!isObj(body)) return { ok: false, error: fail("INVALID_MESSAGE", `${kind} must be an object`, {}) };
    const surfaceId = typeof body.surfaceId === "string" ? body.surfaceId : undefined;
    const bad = (e) => ({ ok: false, error: e });
    if (kind === "callRendererFunction") return callFunction(body);
    if (!["createSurface", "updateComponents", "updateDataModel", "deleteSurface"].includes(kind)) return bad(fail("INVALID_MESSAGE", `unknown message "${kind.slice(0, 40)}"`, {}));
    if (!surfaceId) return bad(fail("INVALID_MESSAGE", `${kind} needs a surfaceId`, {}));
    if (kind === "createSurface") {
      if (surfaces.has(surfaceId)) return bad(fail("VALIDATION_FAILED", `surface "${surfaceId}" already exists`, { surfaceId, path: "/surfaceId" }));
      if (body.components !== undefined) { const e = checkComponents(body.components, surfaceId); if (e) return bad(e); }
      surfaces.set(surfaceId, { id: surfaceId, catalogId: body.catalogId ?? BASIC_CATALOG_ID, sendDataModel: body.sendDataModel === true, components: new Map((body.components ?? []).map((c) => [c.id, c])), data: isObj(body.dataModel) ? structuredClone(body.dataModel) : {}, ui: { tab: {}, modal: {} } });
    } else {
      const s = surfaces.get(surfaceId);
      if (!s) return bad(fail("VALIDATION_FAILED", `no surface "${surfaceId}"`, { surfaceId, path: "/surfaceId" }));
      if (kind === "deleteSurface") surfaces.delete(surfaceId);
      else if (kind === "updateComponents") { const e = checkComponents(body.components, surfaceId); if (e) return bad(e); for (const c of body.components) s.components.set(c.id, c); }
      else {
        if (body.value === undefined) return bad(fail("VALIDATION_FAILED", "updateDataModel needs a value (null removes the key)", { surfaceId, path: "/value" }));
        s.data = setAt(s.data, body.path ?? "/", body.value === null ? null : structuredClone(body.value));
      }
    }
    rev++;
    return { ok: true };
  }

  /** Applies a list of messages, or JSON lines, in order. Stops at nothing: each message stands alone. */
  function applyAll(input) {
    let list = input;
    if (typeof input === "string") {
      list = [];
      for (const line of input.split("\n").map((l) => l.trim()).filter(Boolean)) { try { list.push(JSON.parse(line)); } catch { list.push({ bad: line.slice(0, 60) }); } }
    }
    const errors = []; let applied = 0;
    for (const m of Array.isArray(list) ? list : [list]) { const r = apply(m); if (r.ok) applied++; else errors.push(r.error.error); }
    return { applied, errors };
  }

  // ---- Values ----

  function resolve(s, v, scope, activated = false) {
    if (isObj(v) && typeof v["@path"] === "string") return getAt(s.data, absPath(v["@path"], scope));
    if (isObj(v) && typeof v["@call"] === "string") return call(s, v, scope, activated).value;
    return v;
  }
  function call(s, v, scope, activated) {
    const f = FUNCTIONS[v["@call"]];
    if (!f) return { error: { code: "INVALID_FUNCTION_CALL", message: `no function "${String(v["@call"]).slice(0, 40)}"` } };
    if (f.requiresUserActivation && !activated) return { error: { code: "INVALID_FUNCTION_CALL", message: `${v["@call"]} runs only when a person taps` } };
    const args = Object.fromEntries(Object.entries(isObj(v.args) ? v.args : {}).map(([k, a]) => [k, Array.isArray(a) ? a.map((x) => resolve(s, x, scope, activated)) : resolve(s, a, scope, activated)]));
    try { return { value: f.run(args, { read: (p) => getAt(s.data, absPath(p, scope)), effect: (e) => effects.push(e) }) }; }
    catch (e) { return { error: { code: "EXECUTION_ERROR", message: String(e?.message ?? e).slice(0, 200) } }; }
  }

  /** An agent's callRendererFunction: runs it, unless it needs a person's tap, and answers with rendererFunctionResponse. */
  function callFunction(body) {
    const id = body.functionCallId, s = surfaces.get(body.surfaceId) ?? { data: {} };
    if (typeof id !== "string" || !isObj(body.callFunction)) return { ok: false, error: fail("INVALID_MESSAGE", "callRendererFunction needs functionCallId and callFunction", {}) };
    const r = call(s, body.callFunction, "/", false);
    outbox.push({ version: VERSION, rendererFunctionResponse: r.error ? { functionCallId: id, error: r.error } : { functionCallId: id, value: r.value ?? null } });
    return r.error ? { ok: false, error: { version: VERSION, error: r.error } } : { ok: true };
  }

  // ---- Drawing ----

  const str = (s, v, scope) => { const r = resolve(s, v, scope); return r === undefined || r === null ? "" : typeof r === "object" ? JSON.stringify(r) : String(r); };
  const firstFail = (s, c, scope) => (Array.isArray(c["@checks"]) ? c["@checks"] : []).find((k) => isObj(k) && !resolve(s, k.condition, scope));
  const FLEX = { start: "flex-start", center: "center", end: "flex-end", spaceBetween: "space-between", spaceAround: "space-around", spaceEvenly: "space-evenly", stretch: "stretch" };

  function childIds(s, c, scope) {
    const ch = c.children;
    if (Array.isArray(ch)) return ch.map((id) => ({ id, scope }));
    if (isObj(ch) && typeof ch.componentId === "string") {
      const base = absPath(ch.path ?? "/", scope), items = getAt(s.data, base);
      const keys = Array.isArray(items) ? items.map((_, i) => i) : isObj(items) ? Object.keys(items) : [];
      return keys.map((k) => ({ id: ch.componentId, scope: toPointer([...pointerParts(base), k]) }));
    }
    return [];
  }

  /** The words a component and its children show, in reading order: what names a button that holds them. */
  function textOf(s, id, scope, depth = 0) {
    const c = s.components.get(id);
    if (!c || depth > 8) return "";
    if (isObj(c["@accessibility"]) && typeof c["@accessibility"].label === "string") return c["@accessibility"].label;
    if (c.component === "Text") return str(s, c.text, scope);
    if (c.component === "Icon") return isObj(c.name) ? "" : str(s, c.name, scope);
    if (c.component === "Image") return str(s, c.description, scope);
    const kids = c.child !== undefined ? [{ id: c.child, scope }] : childIds(s, c, scope);
    return kids.map((k) => textOf(s, k.id, k.scope, depth + 1)).filter(Boolean).join(" ");
  }

  function draw(s, id, scope, seen = new Set()) {
    const c = s.components.get(id);
    // A child that has not arrived yet, or a loop: a quiet placeholder.
    if (!c || seen.has(`${id}@${scope}`)) return `<span class="a-wait" data-missing="${esc(id)}"></span>`;
    const inner = new Set(seen).add(`${id}@${scope}`);
    const kid = (cid, sc = scope) => draw(s, cid, sc, inner);
    const a11y = isObj(c["@accessibility"]) ? c["@accessibility"] : {};
    if (a11y.hidden === true) return "";
    const al = typeof a11y.label === "string" ? ` aria-label="${esc(a11y.label)}"` : "";
    const at = ` data-id="${esc(id)}" data-surface="${esc(s.id)}" data-scope="${esc(scope)}"`;
    const weight = typeof c.weight === "number" ? ` style="flex:${c.weight} 1 0"` : "";
    const bind = (v) => (isObj(v) && typeof v["@path"] === "string" ? ` data-bind="${esc(absPath(v["@path"], scope))}"` : "");
    const failing = firstFail(s, c, scope);
    const alert = failing ? `<span class="a-err" role="alert">${esc(str(s, failing.message, scope))}</span>` : "";
    const label = str(s, c.label, scope);
    switch (c.component) {
      case "Text": return `<p class="a-text a-${c.variant === "caption" ? "caption" : "body"}"${al}${at}${weight}>${esc(str(s, c.text, scope))}</p>`;
      case "Image": return `<img class="a-img a-img-${esc(c.variant ?? "mediumFeature")}" style="object-fit:${esc({ scaleDown: "scale-down" }[c.fit] ?? c.fit ?? "fill")}" src="${esc(str(s, c.url, scope))}" alt="${esc(a11y.label ?? str(s, c.description, scope))}"${at}>`;
      case "Icon": { const n = isObj(c.name) && c.name.svgPath !== undefined ? "icon" : str(s, c.name, scope); return `<span class="a-icon" role="img" aria-label="${esc(a11y.label ?? n)}"${at}>${isObj(c.name) && c.name.svgPath !== undefined ? `<svg viewBox="0 0 24 24" width="24" height="24"><path d="${esc(str(s, c.name.svgPath, scope))}"/></svg>` : "◆"}</span>`; }
      case "Video": return `<video class="a-media" controls src="${esc(str(s, c.url, scope))}"${c.posterUrl !== undefined ? ` poster="${esc(str(s, c.posterUrl, scope))}"` : ""}${al || ' aria-label="Video"'}${at}></video>`;
      case "AudioPlayer": return `<audio class="a-media" controls src="${esc(str(s, c.url, scope))}" aria-label="${esc(a11y.label ?? (str(s, c.description, scope) || "Audio"))}"${at}></audio>`;
      case "Row": case "Column": return `<div class="a-${c.component === "Row" ? "row" : "col"}" style="justify-content:${FLEX[c.justify] ?? "flex-start"};align-items:${FLEX[c.align] ?? "stretch"}${typeof c.weight === "number" ? `;flex:${c.weight} 1 0` : ""}"${al}${at}>${childIds(s, c, scope).map((k) => kid(k.id, k.scope)).join("")}</div>`;
      case "List": return `<ul class="a-list a-list-${c.direction === "horizontal" ? "h" : "v"}" role="list"${al}${at}>${childIds(s, c, scope).map((k) => `<li>${kid(k.id, k.scope)}</li>`).join("")}</ul>`;
      case "Card": return `<section class="a-card"${al}${at}${weight}>${kid(c.child)}</section>`;
      case "Divider": return `<hr class="a-div a-div-${c.axis === "vertical" ? "v" : "h"}"${at}>`;
      case "Tabs": {
        const tabs = Array.isArray(c.tabs) ? c.tabs.filter(isObj) : [], cur = Math.min(Number(s.ui.tab[id] ?? 0), Math.max(0, tabs.length - 1));
        return `<div class="a-tabs"${at}><div role="tablist"${al}>${tabs.map((t, i) => `<button role="tab" aria-selected="${i === cur}" data-tab="${i}"${at}>${esc(str(s, t.title, scope))}</button>`).join("")}</div><div role="tabpanel">${tabs[cur] ? kid(tabs[cur].child) : ""}</div></div>`;
      }
      case "Modal": {
        const open = s.ui.modal[id] === true;
        return `<div class="a-modal-trigger" data-modal="open"${at}>${kid(c.trigger)}</div>${open ? `<div class="a-modal" role="dialog" aria-modal="true"${al || ' aria-label="Dialog"'}><div class="a-sheet">${kid(c.content)}<button class="a-btn a-btn-borderless" data-modal="close"${at}>Close</button></div></div>` : ""}`;
      }
      // A button is named by the text inside it, so a screen reader and an agent both get "Create account", not an unnamed button.
      case "Button": return `<button class="a-btn a-btn-${esc(c.variant ?? "default")}" data-press="1"${failing ? " disabled" : ""}${al || ` aria-label="${esc(textOf(s, c.child, scope))}"`}${at}${weight}>${kid(c.child)}</button>${alert}`;
      case "TextField": {
        const v = esc(str(s, c.value, scope)), ph = c.placeholder !== undefined ? ` placeholder="${esc(str(s, c.placeholder, scope))}"` : "";
        const field = c.variant === "longText" ? `<textarea class="a-input" data-input="text"${bind(c.value)}${ph}${at}>${v}</textarea>` : `<input class="a-input" type="${c.variant === "number" ? "number" : c.variant === "obscured" ? "password" : "text"}" value="${v}" data-input="${c.variant === "number" ? "number" : "text"}"${bind(c.value)}${ph}${at}>`;
        return `<div class="a-field"${weight}><label><span>${esc(a11y.label ?? label)}</span>${field}</label>${alert}</div>`;
      }
      case "CheckBox": return `<label class="a-check"${weight}><input type="checkbox" data-input="bool"${resolve(s, c.value, scope) === true ? " checked" : ""}${bind(c.value)}${at}><span>${esc(a11y.label ?? label)}</span></label>${alert}`;
      case "ChoicePicker": {
        const multi = c.variant === "multipleSelection", sel = resolve(s, c.value, scope), chosen = Array.isArray(sel) ? sel.map(String) : sel === undefined || sel === null ? [] : [String(sel)];
        const opts = (Array.isArray(c.options) ? c.options.filter(isObj) : []).map((o) => `<label class="a-opt a-opt-${c.displayStyle === "chips" ? "chip" : "box"}"><input type="${multi ? "checkbox" : "radio"}" name="${esc(`${s.id}:${id}:${scope}`)}" value="${esc(o.value)}" data-input="${multi ? "many" : "one"}"${chosen.includes(String(o.value)) ? " checked" : ""}${bind(c.value)}${at}><span>${esc(str(s, o.label, scope))}</span></label>`).join("");
        return `<fieldset class="a-pick"${weight}><legend>${esc(a11y.label ?? label)}</legend>${opts}${alert}</fieldset>`;
      }
      case "Slider": { const v = Number(resolve(s, c.value, scope) ?? c.min ?? 0); return `<div class="a-field"${weight}><label><span>${esc(a11y.label ?? label)}</span><input type="range" min="${Number(c.min ?? 0)}" max="${Number(c.max)}"${Number.isInteger(c.steps) && c.steps > 0 ? ` step="${(Number(c.max) - Number(c.min ?? 0)) / c.steps}"` : ""} value="${Number.isFinite(v) ? v : 0}" data-input="number"${bind(c.value)}${at}></label>${alert}</div>`; }
      case "DateTimeInput": { const type = c.enableDate && c.enableTime ? "datetime-local" : c.enableTime ? "time" : "date"; return `<div class="a-field"${weight}><label><span>${esc(a11y.label ?? label)}</span><input class="a-input" type="${type}" value="${esc(str(s, c.value, scope))}"${c.min !== undefined ? ` min="${esc(str(s, c.min, scope))}"` : ""}${c.max !== undefined ? ` max="${esc(str(s, c.max, scope))}"` : ""} data-input="text"${bind(c.value)}${at}></label>${alert}</div>`; }
      case "Stat": { const d = str(s, c.delta, scope); return `<div class="a-stat" role="status" aria-label="${esc(a11y.label ?? `${str(s, c.label, scope)}: ${str(s, c.value, scope)}${d ? `, ${d}` : ""}`)}"${at}${weight}><span class="a-caption">${esc(str(s, c.label, scope))}</span><strong>${esc(str(s, c.value, scope))}</strong>${d ? `<em>${esc(d)}</em>` : ""}</div>`; }
      case "Badge": return `<span class="a-badge a-tone-${esc(["success", "warning", "danger"].includes(c.tone) ? c.tone : "neutral")}" role="status"${al}${at}>${esc(str(s, c.text, scope))}</span>`;
      case "Progress": { const max = Number(c.max) > 0 ? Number(c.max) : 100, v = Math.min(max, Math.max(0, Number(resolve(s, c.value, scope)) || 0)), pct = Math.round((v / max) * 100); return `<div class="a-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${v}" aria-label="${esc(a11y.label ?? `${str(s, c.label, scope) || "Progress"}: ${pct}%`)}"${at}${weight}><i style="width:${pct}%"></i></div>`; }
      default: return "";
    }
  }

  /** Every surface as HTML, oldest first. A surface with no "root" component yet draws nothing. */
  const html = () => [...surfaces.values()].map((s) => `<main class="a-surface" data-surface="${esc(s.id)}" aria-label="${esc(s.id)}">${s.components.has("root") ? draw(s, "root", "/") : ""}</main>`).join("");

  // ---- What the person does ----

  /** One thing done on the phone: { kind: "input" | "press" | "tab" | "modal", surfaceId, ... }. Returns { ok } and, for a press, the message sent. */
  function op(o) {
    const s = surfaces.get(o?.surfaceId);
    if (!s) return { ok: false, code: "no_surface" };
    if (o.kind === "input") { if (typeof o.path !== "string" || !o.path.startsWith("/")) return { ok: false, code: "bad_path" }; s.data = setAt(s.data, o.path, o.value === null ? "" : o.value); rev++; return { ok: true }; }
    if (o.kind === "tab") { s.ui.tab[o.id] = Number(o.index) || 0; rev++; return { ok: true }; }
    if (o.kind === "modal") { s.ui.modal[o.id] = o.open === true; rev++; return { ok: true }; }
    if (o.kind !== "press") return { ok: false, code: "bad_op" };
    const c = s.components.get(o.id), scope = typeof o.scope === "string" ? o.scope : "/";
    if (!c || c.component !== "Button" || !isObj(c.action)) return { ok: false, code: "not_a_button" };
    if (firstFail(s, c, scope)) return { ok: false, code: "check_failed" };
    rev++;
    // A press is a person's tap, so a function that needs one may run here, and only here.
    if (isObj(c.action.functionCall)) { const r = call(s, c.action.functionCall, scope, true); if (r.error) { fail(r.error.code, r.error.message, { surfaceId: s.id }); return { ok: false, code: r.error.code }; } return { ok: true }; }
    const ev = c.action.event;
    if (!isObj(ev) || typeof ev.name !== "string") return { ok: false, code: "no_action" };
    const context = Object.fromEntries(Object.entries(isObj(ev.context) ? ev.context : {}).map(([k, v]) => [k, resolve(s, v, scope) ?? null]));
    const message = { version: VERSION, action: { name: ev.name, surfaceId: s.id, sourceComponentId: c.id, timestamp: now().toISOString(), context, ...(ev.userMessage !== undefined ? { userMessage: str(s, ev.userMessage, scope) } : {}) } };
    outbox.push(message);
    return { ok: true, message };
  }

  return {
    apply, applyAll, html, op, outbox, effects,
    get rev() { return rev; },
    surfaceIds: () => [...surfaces.keys()],
    dataOf: (id) => surfaces.get(id)?.data,
    /** The messages for the agent since `from` (an index), and the index to ask from next time. */
    take: (from = 0) => ({ messages: outbox.slice(Math.max(0, Number(from) || 0)), next: outbox.length }),
  };
}
