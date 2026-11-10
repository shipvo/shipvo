/**
 * A running app: holds data, state, form drafts and the navigation history, and runs actions.
 * Every control is found by the name an agent sees in the screen tree.
 */
import { evaluate, evaluateTemplate } from "./eval.js";
import { renderInternal, formFields, fieldDefault } from "./render.js";
import type { RenderOptions, RenderResult, Internal, FormField } from "./render.js";
import type { Issue } from "./types.js";

type Obj = Record<string, any>;

export type PressResult =
  | { ok: true; value?: unknown }
  | { ok: false; errors: Record<string, string> }
  | { ok: false; error: string };

export interface App {
  /** The screen on top of the history. */
  readonly screen: string;
  readonly state: Record<string, unknown>;
  /** Collection data by name. */
  readonly data: Record<string, unknown>;
  render(): RenderResult;
  /** Types a value into a form field. `form` and `field` are the names in the screen tree. */
  setField(form: string, field: string, value: unknown): void;
  /** Validates the form. If every field is fine, runs the submit action with the values as its input. */
  submit(form: string): PressResult;
  /** Runs an action by name, the way a generated MCP tool does. Fills in defaults and refuses missing input. */
  call(action: string, input?: Record<string, unknown>): PressResult;
  /** Presses a button by its label (or id). */
  press(button: string): PressResult;
  /** Turns a toggle on or off, by its label. Writes the state value it is bound to. */
  toggle(label: string, value?: boolean): PressResult;
  /** Selects a segment of a segmented control, by the control's label and the option. */
  select(label: string, option: string): PressResult;
  /** Moves a kanban card (by its title) to a column. Runs the board's `onMove` action with the card's values and the column. */
  move(card: string, column: string): PressResult;
  /** Selects a tab by its label. The history starts again at that tab's screen. */
  selectTab(tab: string): PressResult;
  push(screen: string, params?: Record<string, unknown>): PressResult;
  /** Returns to the previous screen. Fails on the first screen. */
  back(): PressResult;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks one value against a form field. Returns the message to show, or undefined when it is fine. */
export function checkField(f: FormField, value: unknown): string | undefined {
  const name = f.label ?? f.name;
  const custom = (m: string) => f.message ?? m;
  const empty = value === undefined || value === null || value === "" || (f.type === "toggle" && value === false && f.required === true);
  if (empty) return f.required ? custom(`${name} is required.`) : undefined;
  switch (f.type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) return custom(`${name} must be a number.`);
      if (f.min !== undefined && n < f.min) return custom(`${name} must be at least ${f.min}.`);
      if (f.max !== undefined && n > f.max) return custom(`${name} must be at most ${f.max}.`);
      return undefined;
    }
    case "date": {
      const v = String(value);
      const d = new Date(`${v}T00:00:00Z`);
      if (!DATE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return custom(`${name} must be a date like 2026-11-07.`);
      return undefined;
    }
    case "choice":
      return (f.options ?? []).map(String).includes(String(value)) ? undefined : custom(`${name} must be one of: ${(f.options ?? []).join(", ")}.`);
    case "toggle":
      return typeof value === "boolean" ? undefined : custom(`${name} must be on or off.`);
    default: {
      const v = String(value);
      if (f.minLength !== undefined && v.length < f.minLength) return custom(`${name} must be at least ${f.minLength} characters.`);
      if (f.maxLength !== undefined && v.length > f.maxLength) return custom(`${name} must be at most ${f.maxLength} characters.`);
      if (f.pattern !== undefined) {
        try { if (!new RegExp(f.pattern).test(v)) return custom(`${name} is not in the right format.`); } catch { return custom(`${name} is not in the right format.`); }
      }
      return undefined;
    }
  }
}

function coerce(f: FormField, value: unknown): unknown {
  if (value === "" || value === undefined) return f.type === "toggle" ? false : null;
  return f.type === "number" ? Number(value) : value;
}

/** The device permissions an action needs, from its steps: a `notify` step needs notifications. Only `notify` is enforced today; blocks that use other device features follow in #1361. Looks inside `then` and `else`. */
export function actionDeviceNeeds(spec: unknown, action: string): string[] {
  const need = new Set<string>();
  const walk = (steps: unknown) => {
    if (!Array.isArray(steps)) return;
    for (const st of steps) {
      if (!st || typeof st !== "object") continue;
      if ("notify" in st) need.add("notifications");
      walk((st as Obj).then);
      walk((st as Obj).else);
    }
  };
  walk((spec as Obj)?.actions?.[action]?.do);
  return [...need].sort();
}

/** `devicePermissions` maps a device permission to the person's answer. `false` denies it. A permission with no answer is allowed. */
export type CreateAppOptions = RenderOptions & { devicePermissions?: Record<string, boolean> };

/** Starts an app at its first screen (or `options.screen`). Invalid specs are refused with the validator's errors. */
export function createApp(spec: unknown, options: CreateAppOptions = {}): { ok: true; app: App } | { ok: false; errors: Issue[] } {
  const first = renderInternal(spec, options);
  if (!first.result.ok) return { ok: false, errors: first.result.errors };
  const s = spec as Obj;
  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries<Obj>(s.state ?? {})) state[k] = v.default ?? null;
  Object.assign(state, options.state);
  const data: Record<string, unknown> = { ...options.data };
  for (const [k, v] of Object.entries<Obj>(s.data ?? {})) if (v.source === "collection" && !(k in data)) data[k] = structuredClone(v.seed ?? []);
  const history: { screen: string; params: Record<string, unknown>; sheet?: boolean }[] = [{ screen: options.screen ?? s.screens[0].id, params: options.params ?? {} }];
  const drafts: Record<string, Record<string, unknown>> = {};
  const fieldErrors: Record<string, Record<string, string>> = {};
  let toast = "";
  let last: Internal = first;

  const top = () => history[history.length - 1]!;
  const current = (): Internal => {
    const r = renderInternal(spec, { ...options, state, data, screen: top().screen, params: top().params, drafts, fieldErrors, canGoBack: history.length > 1, sheet: top().sheet === true, tab: history[0]!.screen, toast });
    last = r;
    return r;
  };
  const nav: Obj[] = s.navigation?.type === "tabs" && Array.isArray(s.navigation.items) ? s.navigation.items : [];
  const hasScreen = (id: string) => s.screens.some((x: Obj) => x.id === id);
  const go = (id: string, params: Record<string, unknown> = {}, presentation?: unknown): PressResult => {
    if (id === "back") return back();
    if (!hasScreen(id)) return { ok: false, error: `There is no screen "${id}".` };
    if (nav.some((n) => n.screen === id)) history.splice(0, history.length);
    const sheet = presentation === "sheet" || s.screens.find((x: Obj) => x.id === id)?.presentation === "sheet";
    history.push({ screen: id, params, ...(sheet ? { sheet: true } : {}) });
    return { ok: true };
  };
  const back = (): PressResult => {
    if (history.length < 2) return { ok: false, error: "There is no previous screen." };
    history.pop();
    return { ok: true };
  };

  const ev = (t: unknown, scope: Obj): unknown => {
    if (typeof t === "string") return t.includes("{{") ? evaluateTemplate(t, scope, options) : t;
    if (Array.isArray(t)) return t.map((x) => ev(x, scope));
    if (t && typeof t === "object") return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, ev(v, scope)]));
    return t;
  };
  const test = (expr: string, scope: Obj) => evaluate(expr.replace(/^\{\{\s*|\s*\}\}$/g, ""), scope, options) === true;

  /** Runs steps against the local data. Returns the `return` value, if a step returned one. */
  const run = (steps: Obj[], scope: Obj): { done: boolean; value?: unknown } => {
    for (const st of steps) {
      const coll = (n: string) => (Array.isArray(data[n]) ? (data[n] as Obj[]) : (data[n] = []) as Obj[]);
      if (typeof st.insert === "string") coll(st.insert).push(ev(st.value, scope) as Obj);
      else if (typeof st.update === "string") {
        const patch = ev(st.value, scope) as Obj;
        data[st.update] = coll(st.update).map((item) => (!st.where || test(st.where, { ...scope, item }) ? { ...item, ...patch } : item));
      } else if (typeof st.delete === "string") {
        data[st.delete] = coll(st.delete).filter((item) => !(!st.where || test(st.where, { ...scope, item })));
      } else if (typeof st.set === "string") state[st.set.replace(/^state\./, "")] = ev(st.value, scope);
      else if ("notify" in st) { /* shown by the phone; the permission was checked before the action ran */ }
      else if (typeof st.toast === "string") toast = String(ev(st.toast, scope));
      else if (typeof st.navigate === "string") go(st.navigate, ev(st.params ?? {}, scope) as Obj, st.presentation);
      else if (typeof st.if === "string") {
        const r = run((test(st.if, scope) ? st.then : st.else) ?? [], scope);
        if (r.done) return r;
      } else if ("return" in st) return { done: true, value: ev(st.return, scope) };
    }
    return { done: false };
  };

  const runAction = (name: string, input: Obj): PressResult => {
    const a = s.actions?.[name];
    if (!a) return { ok: false, error: `There is no action "${name}".` };
    for (const [k, def] of Object.entries<Obj>(a.input ?? {})) {
      if (input[k] === undefined || input[k] === null) {
        if (def.default !== undefined) input[k] = def.default;
        else return { ok: false, error: `invalid_input: ${k} is required.` };
      }
    }
    const denied = actionDeviceNeeds(spec, name).find((p) => options.devicePermissions?.[p] === false);
    if (denied) return { ok: false, error: `permission_denied: the action "${name}" needs the "${denied}" permission, and the person denied it.` };
    try {
      toast = "";
      current();
      const r = run(a.do ?? [], { ...last.scope(), input });
      return { ok: true, value: r.done ? r.value : undefined };
    } catch (e) {
      return { ok: false, error: `action_failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  const find = (kind: "button" | "form" | "toggle" | "segmented" | "card", name: string) => {
    current();
    const hit = last.registry.get(`${kind}:${name}`) ?? [...last.registry.values()].find((r) => r.kind === kind && r.block.label === name);
    return hit;
  };

  const app: App = {
    get screen() { return top().screen; },
    state,
    data,
    render: () => current().result,
    setField(form, field, value) {
      const f = find("form", form);
      const key = String(f?.block.id ?? f?.block.label ?? form);
      (drafts[key] ??= {})[field] = value;
      delete fieldErrors[key]?.[field];
    },
    submit(form) {
      const f = find("form", form);
      if (!f) return { ok: false, error: `There is no form "${form}" on this screen.` };
      const key = String(f.block.id ?? f.block.label);
      const fields = formFields(f.block);
      const draft = drafts[key] ?? {};
      const errs: Record<string, string> = {};
      const input: Obj = {};
      for (const fd of fields) {
        const v = fd.name in draft ? draft[fd.name] : fieldDefault(fd);
        const m = checkField(fd, v);
        if (m) errs[fd.name] = m;
        else input[fd.name] = coerce(fd, v);
      }
      if (Object.keys(errs).length) {
        fieldErrors[key] = errs;
        return { ok: false, errors: errs };
      }
      delete fieldErrors[key];
      const r = runAction(String(f.block.submit?.action ?? ""), input);
      if (r.ok) delete drafts[key];
      return r;
    },
    call: (action, input = {}) => runAction(action, { ...input }),
    press(button) {
      if ((button === "Back" || (button === "Close" && top().sheet)) && history.length > 1) { toast = ""; return back(); }
      const b = find("button", button);
      if (!b) return { ok: false, error: `There is no button "${button}" on this screen.` };
      const on: Obj = b.block.onPress ?? {};
      if (typeof on.action === "string") return runAction(on.action, ev(on.input ?? {}, b.scope) as Obj);
      if (on.back === true) return back();
      if (typeof on.navigate === "string") return go(on.navigate, ev(on.params ?? {}, b.scope) as Obj, on.presentation);
      return { ok: false, error: `Button "${button}" has no onPress.` };
    },
    toggle(label, value) {
      const c = find("toggle", label);
      if (!c) return { ok: false, error: `There is no toggle "${label}" on this screen.` };
      const key = String(c.block.bind).replace(/^state\./, "");
      state[key] = typeof value === "boolean" ? value : state[key] !== true;
      toast = "";
      return { ok: true, value: state[key] };
    },
    select(label, option) {
      const c = find("segmented", label);
      if (!c) return { ok: false, error: `There is no segmented control "${label}" on this screen.` };
      const opts = (Array.isArray(c.block.options) ? c.block.options : []).map(String);
      if (!opts.includes(option)) return { ok: false, error: `"${option}" is not one of: ${opts.join(", ")}.` };
      state[String(c.block.bind).replace(/^state\./, "")] = option;
      toast = "";
      return { ok: true, value: option };
    },
    move(card, column) {
      const c = find("card", card);
      if (!c) return { ok: false, error: `There is no card "${card}" on this screen.` };
      const cols = (Array.isArray(c.block.columns) ? c.block.columns : []).map(String);
      if (!cols.includes(column)) return { ok: false, error: `"${column}" is not one of: ${cols.join(", ")}.` };
      return runAction(String(c.block.onMove.action), ev(c.block.onMove.input ?? {}, { ...c.scope, column }) as Obj);
    },
    selectTab(tab) {
      const r = current().result;
      const t = r.ok ? r.tree.children.find((c) => c.block === "tabs")?.children.find((c) => c.name === tab) : undefined;
      if (!t) return { ok: false, error: `There is no tab "${tab}".` };
      toast = "";
      return go(String(t.props?.screen));
    },
    push: (screen, params) => { toast = ""; return go(screen, params); },
    back: () => { toast = ""; return back(); }
  };
  return { ok: true, app };
}
