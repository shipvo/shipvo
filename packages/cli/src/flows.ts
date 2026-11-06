// Lumi flows: recognise sign up, log in, search, add to cart and checkout by control labels and screen text,
// drive each to its end with valid input, then once with invalid input. No AI model. Works on any `Driver`.
import { elements, signature, sampleValue, describeStep, type Driver, type Step, type Reply } from "./explore.js";

export type FlowName = "signup" | "login" | "search" | "add_to_cart" | "checkout";
export const FLOW_NAMES: FlowName[] = ["signup", "login", "search", "add_to_cart", "checkout"];
export type FlowStatus = "passed" | "failed" | "not_found";
export type FlowRun = { status: FlowStatus | "not_run"; message: string; step?: string; steps: Step[] };
export type FlowResult = { flow: FlowName; status: FlowStatus; message: string; step?: string; steps: Step[]; invalid: FlowRun };
export type FlowReport = { app: string; generatedAt: string; flows: FlowResult[] };

type El = ReturnType<typeof elements>[number];
const FIELD_ROLES = new Set(["textbox", "searchbox"]);
const RISKY = /\b(log ?out|sign ?out|delete|remove|cancel|erase|deactivate|clear all|unsubscribe)\b/i;
const RED = /Uncaught (\w*Error)|Unhandled Runtime Error|Application error|Something went wrong/i;
const NET = /network request failed|network error|failed to fetch|no internet|(?:can't|cannot|couldn't|unable to) connect|connection (?:failed|lost|error)/i;
const REJECTED = /invalid|incorrect|wrong|required|must be|not valid|too short|try again|error|can't be empty|enter a/i;
const ORDER_DONE = /\border\b[^\n]{0,40}\b(placed|confirmed|complete|successful)|payment (?:approved|successful|complete)|thank you|receipt/i;
const ADDED = /\badded\b|in (?:your )?(?:cart|bag|basket)/i;
const ADD_BTN = /^add\b.*\b(cart|bag|basket)\b|^add (?:\d+ )?to (?:cart|bag|basket)/i;
const CART_NAV = /\b(cart|bag|basket|checkout)\b/i;
const NAV_ONLY = /^(back|go back|close|home|menu|settings|about)\b/i;

class Fail extends Error {}

/** Fields (text boxes) in a tree, with the same nth numbering the walker uses. */
function fieldsOf(tree: string): El[] {
  const out: El[] = []; const seen = new Map<string, number>();
  for (const l of tree.split("\n")) {
    const m = /^\s*- (textbox|searchbox)(?: "((?:[^"\\]|\\.)*)")?[^\n]*?\[ref=(\w+)\]/.exec(l);
    if (!m || /\[disabled\]/.test(l)) continue;
    const name = (m[2] ?? "").trim(); const key = `${m[1]}|${name}`; const nth = seen.get(key) ?? 0; seen.set(key, nth + 1);
    out.push({ role: m[1]!, name, ref: m[3]!, nth });
  }
  return out;
}

class Session {
  steps: Step[] = []; screen = "";
  constructor(readonly d: Driver) {}
  private async settle(r: Reply, step: Step): Promise<void> {
    this.steps.push(step);
    if (!r.ok || r.screen == null) throw new Fail(`${describeStep(step)} failed: ${r.error ?? "no screen"}`);
    this.screen = r.screen;
    for (const e of await this.d.errors()) throw new Fail(`${describeStep(step)} raised an error: ${e}`);
    const bad = RED.exec(r.screen)?.[0] ?? NET.exec(r.screen)?.[0];
    if (bad) throw new Fail(`${describeStep(step)} led to a screen that shows "${bad}"`);
  }
  async open() { this.steps = []; await this.settle(await this.d.open(), { action: "open" }); }
  async tap(e: El) { await this.settle(await this.d.tap(e.ref), { action: "tap", role: e.role, name: e.name, nth: e.nth }); }
  async type(e: El, text: string, enter = false) {
    if (!this.d.type) throw new Fail("this simulator cannot type");
    await this.settle(await this.d.type(e.ref, text, enter), { action: "type", role: e.role, name: e.name, nth: e.nth, text, ...(enter ? { enter: true } : {}) });
  }
  async back() { const r = await this.d.back(); if (r.ok && r.screen != null) { this.screen = r.screen; this.steps.push({ action: "back" }); return true; } return false; }
  buttons(re?: RegExp) { return elements(this.screen).filter((e) => e.name && !RISKY.test(e.name) && (!re || re.test(e.name))); }
  /** Type into every field on the screen, in order. Fields are found again after each one, since refs can change. */
  async fill(invalid: boolean, only?: RegExp) {
    const want = fieldsOf(this.screen).filter((f) => !only || only.test(f.name));
    for (const f of want) {
      const cur = fieldsOf(this.screen).find((x) => x.role === f.role && x.name === f.name && x.nth === f.nth);
      if (cur) await this.type(cur, sampleValue(f.name, invalid), invalid && fieldsOf(this.screen).length === 1);
    }
    return want.length;
  }
}

/** Look for something on this screen, then one tap away through navigation controls. If not found, step back (twice at most) and look again. */
async function locate<T>(s: Session, test: (tree: string) => T | null, prefer?: RegExp): Promise<T | null> {
  for (let up = 0; up < 3; up++) {
    const here = test(s.screen); if (here) return here;
    const start = signature(s.screen);
    const hops = s.buttons().filter((e) => !NAV_ONLY.test(e.name) && !FIELD_ROLES.has(e.role) && !ADD_BTN.test(e.name));
    hops.sort((a, b) => Number(!!prefer?.test(b.name)) - Number(!!prefer?.test(a.name)));
    for (const h of hops.slice(0, 8)) {
      await s.tap(h);
      const found = test(s.screen); if (found) return found;
      if (!(await s.back()) || signature(s.screen) !== start) return null;
    }
    if (!(await s.back())) return null;
  }
  return null;
}

const submitBtn = (s: Session, re: RegExp) => s.buttons(re).find((b) => !FIELD_ROLES.has(b.role));
const stillForm = (tree: string, needPass: boolean) => fieldsOf(tree).some((f) => (needPass ? /pass/i : /./).test(f.name));

async function authFlow(s: Session, kind: "signup" | "login", invalid: boolean): Promise<FlowRun> {
  const entry = kind === "signup" ? /sign ?up|register|create (?:an )?account|join/i : /log ?in|sign ?in/i;
  const submit = kind === "signup" ? /sign ?up|register|create|continue|submit|next|join/i : /log ?in|sign ?in|continue|submit/i;
  const hasForm = (t: string) => (fieldsOf(t).some((f) => /pass/i.test(f.name)) || fieldsOf(t).some((f) => /e-?mail|user/i.test(f.name))) && !!elements(t).some((e) => submit.test(e.name)) ? t : null;
  await s.open();
  let form = await locate(s, hasForm);
  if (!form) {
    const e = s.buttons(entry)[0];
    if (e) { await s.tap(e); form = hasForm(s.screen); }
    else { const hop = await locate(s, (t) => (elements(t).find((x) => entry.test(x.name)) ? t : null), /account|profile|menu/i); if (hop) { await s.tap(elements(s.screen).find((x) => entry.test(x.name))!); form = hasForm(s.screen); } }
  }
  if (!form) return { status: "not_found", message: `No ${kind === "signup" ? "sign up" : "log in"} form found on the first screen or one tap away`, steps: s.steps };
  await s.fill(invalid);
  const btn = submitBtn(s, submit);
  if (!btn) throw new Fail("no submit button after filling the form");
  await s.tap(btn);
  const left = !stillForm(s.screen, true) && !REJECTED.test(s.screen);
  if (invalid) return left ? { status: "failed", message: "The app accepted invalid input and moved on", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps } : { status: "passed", message: "The app rejected invalid input and stayed on the form", steps: s.steps };
  return left ? { status: "passed", message: "The form was accepted and the app moved on", steps: s.steps } : { status: "failed", message: `The app did not accept valid input${REJECTED.exec(s.screen) ? ` (screen shows "${REJECTED.exec(s.screen)![0]}")` : ""}`, step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps };
}

async function searchFlow(s: Session, invalid: boolean): Promise<FlowRun> {
  const isSearch = (t: string) => fieldsOf(t).find((f) => /search|find|query/i.test(f.name)) ?? null;
  await s.open();
  const f = await locate(s, isSearch, /search|find/i);
  if (!f) return { status: "not_found", message: "No search field found on the first screen or one tap away", steps: s.steps };
  const before = signature(s.screen);
  const field = isSearch(s.screen)!;
  await s.type(field, sampleValue(field.name, invalid), true);
  if (invalid) return { status: "passed", message: "An empty search did not crash the app", steps: s.steps };
  const go = signature(s.screen) === before ? submitBtn(s, /^(search|find|go)$/i) : undefined;
  if (go) await s.tap(go);
  return signature(s.screen) !== before || s.screen.includes(sampleValue(field.name, false))
    ? { status: "passed", message: "The screen responded to the search", steps: s.steps }
    : { status: "failed", message: "The screen did not change after searching", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps };
}

async function addToCart(s: Session, invalid: boolean): Promise<FlowRun | null> {
  const addIn = (t: string) => (elements(t).find((e) => ADD_BTN.test(e.name)) ? t : null);
  if (!(await locate(s, addIn))) return null;
  const qty = fieldsOf(s.screen).find((f) => /qty|quantity/i.test(f.name));
  if (invalid) {
    if (!qty) return { status: "not_run", message: "No quantity field to give a bad value", steps: s.steps };
    await s.type(qty, "abc"); await s.tap(elements(s.screen).find((e) => ADD_BTN.test(e.name))!);
    return ADDED.test(s.screen) && /abc/.test(s.screen) ? { status: "failed", message: "The app added a quantity of \"abc\"", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps } : { status: "passed", message: "A bad quantity did not crash the app or get added", steps: s.steps };
  }
  const before = signature(s.screen);
  await s.tap(elements(s.screen).find((e) => ADD_BTN.test(e.name))!);
  return signature(s.screen) !== before || ADDED.test(s.screen)
    ? { status: "passed", message: "The add button changed the screen", steps: s.steps }
    : { status: "failed", message: "Nothing changed after the add button", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps };
}

async function cartFlow(s: Session, invalid: boolean): Promise<FlowRun> {
  await s.open();
  const r = await addToCart(s, invalid);
  if (!r) return { status: "not_found", message: "No add-to-cart button found on the first screen or one tap away", steps: s.steps };
  return r;
}

const FINAL = /place order|pay\b|pay now|confirm|submit order|complete/i;
const CHOICE = /pickup|delivery|ship|card|mobile money|cash|standard|express|any day|use my location|fingerprint/i;
const NEXT = /continue|next|proceed|review/i;
async function checkoutFlow(s: Session, invalid: boolean): Promise<FlowRun> {
  await s.open();
  // A cart needs something in it first.
  if (!(await addToCart(s, false))) return { status: "not_found", message: "No add-to-cart button found, so there is no way to reach checkout", steps: s.steps };
  const isCheckout = (t: string) => (elements(t).find((e) => /check ?out|choose delivery|place order|proceed to pay/i.test(e.name)) ? t : null);
  if (!(await locate(s, isCheckout, CART_NAV))) return { status: "not_found", message: "No checkout control found after adding to the cart", steps: s.steps };
  const tapped = new Set<string>();
  for (let i = 0; i < 10; i++) {
    if (ORDER_DONE.test(s.screen)) return invalid ? { status: "failed", message: "The order went through with invalid input", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps } : { status: "passed", message: "The order was placed", steps: s.steps };
    await s.fill(invalid);
    const key = (e: El) => `${signature(s.screen)}|${e.role}|${e.name}|${e.nth}`;
    const cands = [...s.buttons(FINAL), ...s.buttons(CHOICE), ...s.buttons(/check ?out|choose delivery/i), ...s.buttons(NEXT)].filter((e) => !tapped.has(key(e)) && !FIELD_ROLES.has(e.role));
    const next = cands[0];
    if (!next) break;
    tapped.add(key(next));
    await s.tap(next);
  }
  if (ORDER_DONE.test(s.screen)) return invalid ? { status: "failed", message: "The order went through with invalid input", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps } : { status: "passed", message: "The order was placed", steps: s.steps };
  if (invalid) return { status: "passed", message: "Checkout did not complete with invalid input", steps: s.steps };
  return { status: "failed", message: "Checkout stopped before the order was placed: no control left to continue", step: describeStep(s.steps[s.steps.length - 1]!), steps: s.steps };
}

async function once(d: Driver, flow: FlowName, invalid: boolean): Promise<FlowRun> {
  const s = new Session(d);
  try {
    if (flow === "signup" || flow === "login") return await authFlow(s, flow, invalid);
    if (flow === "search") return await searchFlow(s, invalid);
    if (flow === "add_to_cart") return await cartFlow(s, invalid);
    return await checkoutFlow(s, invalid);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return { status: "failed", message: e.message, step: s.steps.length ? describeStep(s.steps[s.steps.length - 1]!) : undefined, steps: s.steps };
  }
}

/** Run each flow with valid input, then once with invalid input. Each run starts on a fresh phone. */
export async function runFlows(d: Driver, o: { flows?: FlowName[]; app?: string } = {}): Promise<FlowReport> {
  const out: FlowResult[] = [];
  for (const flow of o.flows ?? FLOW_NAMES) {
    const valid = await once(d, flow, false);
    const status = valid.status === "not_run" ? "not_found" : valid.status;
    const invalid: FlowRun = status === "not_found" ? { status: "not_run", message: "The flow was not found", steps: [] } : await once(d, flow, true);
    out.push({ flow, status, message: valid.message, step: valid.step, steps: valid.steps, invalid });
  }
  return { app: o.app ?? "", generatedAt: new Date().toISOString(), flows: out };
}

export function renderFlows(r: FlowReport): string {
  const L = [`# Flow report: ${r.app}`, "", "| Flow | Valid input | Invalid input |", "| --- | --- | --- |"];
  for (const f of r.flows) L.push(`| ${f.flow.replace("_", " ")} | ${f.status} | ${f.invalid.status === "not_run" ? "not run" : f.invalid.status} |`);
  L.push("");
  for (const f of r.flows) {
    L.push(`## ${f.flow.replace("_", " ")}`, "", `- Valid input: ${f.status}. ${f.message}.${f.step ? ` Failed at: ${f.step}.` : ""}`, `- Invalid input: ${f.invalid.status === "not_run" ? "not run" : f.invalid.status}. ${f.invalid.message}.${f.invalid.step ? ` Failed at: ${f.invalid.step}.` : ""}`, "");
    if (f.status === "failed") L.push("Steps to reproduce:", "", ...f.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`), "");
  }
  return L.join("\n");
}
