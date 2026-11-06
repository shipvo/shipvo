// Small spec apps for the Lumi benchmark. Each app is a few screens that a `Driver` can walk, with planted bugs
// that a flag turns on. No browser or simulator is needed, so a run is fast and repeats exactly.

/** Every bug has an id, the kind of finding that shows it, and a test over the walk and flow reports. */
const lastTap = (f) => { const s = f.steps[f.steps.length - 1]; return s && s.action === "tap" ? s.name : null; };
const finding = (kind, control) => (walk) => walk.findings.some((f) => f.kind === kind && lastTap(f) === control);
const badInput = (flow) => (_walk, flows) => flows.flows.some((f) => f.flow === flow && f.invalid.status === "failed" && /went through|accepted/.test(f.invalid.message));

const ok = (v, re) => re.test(v ?? "");
const T = (name) => ({ t: "text", name });

function shop(bugs) {
  const placeOrder = (st) => {
    const valid = ok(st.values.Name, /\S/) && ok(st.values.Phone, /^\+?\d{7,}$/);
    if (!valid && !bugs.has("bad_validation")) return { text: "Enter a valid name and phone number" };
    st.cart = 0; return { go: "done" };
  };
  return {
    start: "home",
    screens: {
      home: () => [{ t: "heading", name: "Shop" }, { t: "searchbox", name: "Search", onEnter: (st, q) => { st.query = q; } }, { t: "button", name: "Sea Bass 12 USD", go: "product" }, { t: "button", name: "Cart", go: "cart", net: bugs.has("network") }],
      product: (st) => [{ t: "heading", name: "Sea Bass" }, T(`Cart: ${st.cart} items`), { t: "button", name: "Add to cart", dead: bugs.has("dead_button"), act: (s) => { s.cart++; } }, { t: "button", name: "Cart", go: "cart" }, { t: "button", name: "Back", back: true }],
      cart: (st) => [{ t: "heading", name: "Your cart" }, T(`Cart: ${st.cart} items`), { t: "button", name: "Checkout", go: "checkout" }, { t: "button", name: "Back", back: true }],
      checkout: () => [{ t: "heading", name: "Checkout" }, { t: "textbox", name: "Name" }, { t: "textbox", name: "Phone" }, { t: "button", name: "Place order", submit: placeOrder }, { t: "button", name: "Back", back: true }],
      done: () => [{ t: "heading", name: "Thank you" }, T("Order placed"), { t: "button", name: "Home", go: "home" }],
    },
    resultsText: (st) => (st.query ? [T(`Results for ${st.query}`)] : []),
  };
}

function account(bugs) {
  const signup = (st) => (bugs.has("bad_validation") || (ok(st.values.Email, /^[^@\s]+@[^@\s]+\.\w+$/) && (st.values.Password ?? "").length >= 8) ? { go: "welcome" } : { text: "Enter a valid email and a password of 8 or more characters" });
  const login = (st) => (ok(st.values.Email, /^[^@\s]+@[^@\s]+\.\w+$/) && (st.values.Password ?? "").length >= 8 ? { go: "welcome" } : { text: "Incorrect email or password" });
  return {
    start: "home",
    screens: {
      home: () => [{ t: "heading", name: "Account" }, { t: "button", name: "Sign up", go: "signup" }, { t: "button", name: "Log in", go: "login" }, { t: "button", name: "About", go: "about" }, { t: "button", name: "Help", go: "help", throws: bugs.has("broken_route") }, { t: "button", name: "Gallery", go: "gallery" }],
      signup: () => [{ t: "heading", name: "Create account" }, { t: "textbox", name: "Email" }, { t: "textbox", name: "Password" }, { t: "button", name: "Sign up", submit: signup }, { t: "button", name: "Back", back: true }],
      login: () => [{ t: "heading", name: "Welcome back" }, { t: "textbox", name: "Email" }, { t: "textbox", name: "Password" }, { t: "button", name: "Log in", submit: login }, { t: "button", name: "Back", back: true }],
      welcome: () => [{ t: "heading", name: "You are in" }, { t: "button", name: "Home", go: "home" }],
      about: () => [{ t: "heading", name: "About" }, T("Version 1"), { t: "button", name: "Back", back: true }],
      help: () => [{ t: "heading", name: "Help" }, T("Ask us anything"), { t: "button", name: "Back", back: true }],
      gallery: () => (bugs.has("blank_screen") ? [] : [{ t: "heading", name: "Gallery" }, { t: "button", name: "Back", back: true }]),
    },
  };
}

/** The spec apps. `held_out` apps are for checking a change that was tuned on the others. */
export const SPEC_APPS = [
  {
    id: "shop", heldOut: false, build: shop,
    bugs: [
      { id: "shop:dead_button", kind: "dead button", found: finding("not_delivered", "Add to cart") },
      { id: "shop:failing_network_call", kind: "failing network call", found: finding("network_failed", "Cart") },
      { id: "shop:bad_validation", kind: "validation accepts bad input", found: badInput("checkout") },
    ],
    bugFlags: { "shop:dead_button": "dead_button", "shop:failing_network_call": "network", "shop:bad_validation": "bad_validation" },
  },
  {
    id: "account", heldOut: true, build: account,
    bugs: [
      { id: "account:broken_route", kind: "broken route", found: finding("error", "Help") },
      { id: "account:blank_screen", kind: "blank screen", found: finding("blank_screen", "Gallery") },
      { id: "account:bad_validation", kind: "validation accepts bad input", found: badInput("signup") },
    ],
    bugFlags: { "account:broken_route": "broken_route", "account:blank_screen": "blank_screen", "account:bad_validation": "bad_validation" },
  },
];

/** A `Driver` over a spec app. `bugs` is the set of planted bug flags that are on. */
export function specDriver(app, bugs = new Set()) {
  const spec = app.build(bugs);
  let st, at, stack, pending, refs;
  const reset = () => { st = { values: {}, cart: 0, query: "", note: "" }; at = spec.start; stack = []; pending = []; };
  reset();
  const render = () => {
    const items = [...spec.screens[at](st), ...(at === "home" && spec.resultsText ? spec.resultsText(st) : []), ...(st.note ? [T(st.note)] : [])];
    refs = new Map();
    const lines = items.map((it, i) => {
      const ref = `e${i + 1}`; refs.set(ref, it);
      return it.t === "text" ? `- text "${it.name}" [ref=${ref}]` : `- ${it.t} "${it.name}" [ref=${ref}]`;
    });
    return lines.join("\n");
  };
  const view = (extra = {}) => ({ ok: true, screen: render(), ...extra });
  const go = (to) => { stack.push(at); at = to; st.note = ""; };
  return {
    async open() { reset(); return view(); },
    async openUrl() { return view(); },
    async tap(ref) {
      const it = refs.get(ref);
      if (!it) return { ok: false, error: `no element ${ref}`, screen: render() };
      if (it.dead) return view({ delivery: "not_delivered", reason: "covered", error: "the tap was covered by another element" });
      if (it.back) { const p = stack.pop(); if (p) { at = p; st.note = ""; } return view({ delivery: "delivered" }); }
      if (it.net) pending.push("TypeError: Network request failed");
      if (it.throws) pending.push("ReferenceError: route is not defined");
      it.act?.(st);
      if (it.submit) { const r = it.submit(st); if (r.go) go(r.go); else st.note = r.text ?? ""; }
      else if (it.go) go(it.go);
      return view({ delivery: "delivered" });
    },
    async back() { const p = stack.pop(); if (!p) return { ok: false, error: "no Back button", screen: render() }; at = p; st.note = ""; return view(); },
    async type(ref, text, enter) {
      const it = refs.get(ref);
      if (!it) return { ok: false, error: `no element ${ref}`, screen: render() };
      st.values[it.name] = text;
      if (enter) it.onEnter?.(st, text);
      return view({ delivery: "delivered" });
    },
    async snapshot() { return view(); },
    async errors() { const e = pending; pending = []; return e; },
  };
}
