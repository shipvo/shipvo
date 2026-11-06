import { describe, expect, it } from "vitest";
import { runFlows, renderFlows } from "../src/flows.js";
import type { Driver, Reply } from "../src/explore.js";

// A fake shop shaped like apps/tide-and-tackle: a search box, products, an "Add 1 to cart" button, a cart and a checkout form.
// It has no sign up and no log in. `bug` switches on one fault at a time.
type Bug = "none" | "add_noop" | "checkout_accepts_bad" | "checkout_crash" | "search_noop";
function shop(bug: Bug = "none"): Driver {
  let at = "home"; let q = ""; let carted = false; let address = ""; const stack: string[] = [];
  const S = (): string => {
    switch (at) {
      case "home": return `- heading "Tide & Tackle" [ref=e1]\n- searchbox "Search rods, lures, line…" [ref=e2]\n- button "Surface Popper 9 cm, 4 500 FCFA" [ref=e3]\n- button "Department Lures" [ref=e5]\n- button "Open cart" [ref=e4]${q ? `\n- text: Results for ${q}` : ""}`;
      case "product": return `- heading "Surface Popper 9 cm" [ref=e1]\n- button "Add 1 to cart" [ref=e2]\n- button "Back" [ref=e3]${carted && bug !== "add_noop" ? "\n- text: Added" : ""}`;
      case "cart": return carted ? `- heading "Cart" [ref=e1]\n- button "Choose delivery and pay" [ref=e2]\n- button "Back" [ref=e3]` : `- heading "Cart" [ref=e1]\n- text: Empty\n- button "Back" [ref=e3]`;
      case "pay": return `- heading "Delivery" [ref=e1]\n- textbox "Delivery address" [ref=e2]\n- button "Shop pickup" [ref=e3]\n- button "Place order" [ref=e4]\n- button "Back" [ref=e5]${address === "" ? "\n- text: Enter an address" : ""}`;
      case "home2": return `- heading "Lures" [ref=e1]\n- button "Back" [ref=e2]`;
      default: return `- heading "Order TT-1001 placed" [ref=e1]\n- button "Back to shop" [ref=e2]`;
    }
  };
  const view = (): Reply => ({ ok: true, screen: S() });
  const go = (to: string) => { stack.push(at); at = to; };
  return {
    async open() { at = "home"; q = ""; carted = false; address = ""; stack.length = 0; return view(); },
    async openUrl() { return view(); },
    async tap(ref) {
      const name = new RegExp(`- (?:button|searchbox) "([^"]+)" \\[ref=${ref}\\]`).exec(S())?.[1] ?? "?";
      if (name.startsWith("Surface Popper")) go("product");
      else if (name === "Add 1 to cart") carted = true;
      else if (name === "Department Lures") go("home2")
      else if (name === "Open cart") go("cart");
      else if (name === "Choose delivery and pay") go("pay");
      else if (name === "Back to shop") { at = "home"; stack.length = 0; }
      else if (name === "Place order") {
        if (bug === "checkout_crash") return { ok: false, error: "boom", screen: S() };
        if (address !== "" || bug === "checkout_accepts_bad") at = "done";
      }
      return { ...view(), delivery: "delivered" };
    },
    async type(ref, text, enter) {
      const name = new RegExp(`- (?:button|searchbox|textbox) "([^"]+)" \\[ref=${ref}\\]`).exec(S())?.[1] ?? "?";
      if (name.startsWith("Search")) { q = bug === "search_noop" ? "" : text; void enter; }
      else address = text;
      return view();
    },
    async back() { const p = stack.pop(); if (!p) return { ok: false, error: "no back", screen: S() }; at = p; return view(); },
    async errors() { return []; },
  };
}
const FAKE_LOGIN = (): Driver => {
  let at = "home"; let email = ""; let pass = "";
  const S = () => at === "home" ? `- heading "Welcome" [ref=e1]\n- button "Log in" [ref=e2]\n- button "Sign up" [ref=e3]`
    : at === "form" ? `- heading "Account" [ref=e1]\n- textbox "Email" [ref=e2]\n- textbox "Password" [ref=e3]\n- button "Continue" [ref=e4]${email && !/@/.test(email) ? "\n- text: Enter a valid email" : ""}`
    : `- heading "You are in" [ref=e1]\n- button "Profile" [ref=e2]`;
  const v = (): Reply => ({ ok: true, screen: S() });
  return {
    async open() { at = "home"; email = pass = ""; return v(); }, async openUrl() { return v(); },
    async tap(ref) { const n = new RegExp(`button "([^"]+)" \\[ref=${ref}\\]`).exec(S())?.[1]; if (n === "Log in" || n === "Sign up") at = "form"; else if (n === "Continue" && /^\S+@\S+\.\S+$/.test(email) && pass.length > 3) at = "in"; return v(); },
    async type(ref, text) { if (ref === "e2") email = text; else pass = text; return v(); },
    async back() { return { ok: false, screen: S() }; }, async errors() { return []; },
  };
};

const by = async (d: Driver) => Object.fromEntries((await runFlows(d)).flows.map((f) => [f.flow, f]));

describe("flows on a Tide-shaped shop", () => {
  it("finishes search, add to cart and checkout; sign up and log in are not found", async () => {
    const f = await by(shop());
    expect(f.search!.status).toBe("passed");
    expect(f.add_to_cart!.status).toBe("passed");
    expect(f.checkout!.status).toBe("passed");
    expect(f.checkout!.invalid.status).toBe("passed");
    expect(f.signup!.status).toBe("not_found");
    expect(f.login!.status).toBe("not_found");
    expect(f.login!.invalid.status).toBe("not_run");
  });
  it("fails add to cart with the step when the button does nothing", async () => {
    const f = (await by(shop("add_noop"))).add_to_cart!;
    expect(f.status).toBe("failed");
    expect(f.step).toBe('tap button "Add 1 to cart"');
  });
  it("fails search when the screen does not respond", async () => {
    expect((await by(shop("search_noop"))).search!.status).toBe("failed");
  });
  it("fails checkout when the app accepts an empty address", async () => {
    const f = (await by(shop("checkout_accepts_bad"))).checkout!;
    expect(f.status).toBe("passed");
    expect(f.invalid.status).toBe("failed");
    expect(f.invalid.step).toBe('tap button "Place order"');
  });
  it("fails checkout with the step when the app errors", async () => {
    const f = (await by(shop("checkout_crash"))).checkout!;
    expect(f.status).toBe("failed");
    expect(f.step).toBe('tap button "Place order"');
  });
  it("runs only the flows asked for and renders a report", async () => {
    const r = await runFlows(shop(), { flows: ["search"], app: "tide" });
    expect(r.flows).toHaveLength(1);
    const md = renderFlows(r);
    expect(md).toContain("| search | passed | passed |");
  });
});

describe("login and sign up", () => {
  it("passes with valid input and with invalid input being rejected", async () => {
    const f = await by(FAKE_LOGIN());
    for (const k of ["login", "signup"]) { expect(f[k]!.status).toBe("passed"); expect(f[k]!.invalid.status).toBe("passed"); }
  });
  it("fails the invalid run when bad input is accepted", async () => {
    const d = FAKE_LOGIN(); const tap = d.tap.bind(d);
    d.tap = async (ref) => { const r = await tap(ref); return ref === "e4" && r.screen!.includes("Continue") ? { ...r, screen: `- heading "You are in" [ref=e1]` } : r; };
    const f = (await by(d)).login!;
    expect(f.invalid.status).toBe("failed");
  });
});
