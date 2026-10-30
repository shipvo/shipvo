// Tide & Tackle shop logic as typed commands. The same commands drive the app's screens and the headless agent
// surface, so whatever an agent can do here is exactly what a user can do in the app. Pure TypeScript, no React Native.
import { DEFAULT_CONTENT } from "./catalog.ts";
import type { AppContent, Product } from "../content/types.ts";

// The live content (catalogue, promos, slots). The app swaps it when the admin publishes; agents use the same.
let C: AppContent = DEFAULT_CONTENT;
export const setContent = (c: AppContent) => { C = c; };
export const getContent = () => C;

export type CartLine = { product_id: string; quantity: number };
export type Order = {
  id: string; lines: (CartLine & { name: string; unit_price: number })[]; subtotal: number; discount: number;
  delivery_fee: number; total: number; promo: string | null; slot_id: string; address: string;
  payment: "cash_on_delivery" | "mobile_money"; phone: string | null; status: "placed";
};
export type ShopState = {
  cart: CartLine[]; promo: string | null; delivery: { slot_id: string; address: string } | null; orders: Order[];
  stock: Record<string, number>; slot_capacity: Record<string, number>;
};

export const initialState = (): ShopState => ({
  cart: [], promo: null, delivery: null, orders: [],
  stock: Object.fromEntries(C.products.map((p) => [p.id, p.stock])),
  slot_capacity: Object.fromEntries(C.slots.map((s) => [s.id, s.capacity])),
});

export class CommandError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const fail = (code: string, message: string): never => { throw new CommandError(code, message); };
const product = (id: string) => C.products.find((p) => p.id === id) ?? fail("not_found", `No product with id '${id}'. Use search_products to find ids.`);
export const stockOf = (s: ShopState, id: string) => s.stock[id] ?? C.products.find((p) => p.id === id)?.stock ?? 0;
const view = (s: ShopState, p: Product) => ({ id: p.id, name: p.name, department: p.department, price_fcfa: p.price, in_stock: stockOf(s, p.id) > 0, stock: stockOf(s, p.id), water: p.water, tags: p.tags, description: p.description, image_url: p.image_url ?? null });
const promoOf = (code: string) => C.promos.find((p) => p.active && p.code === code);
const slotCap = (s: ShopState, id: string) => s.slot_capacity[id] ?? C.slots.find((x) => x.id === id)?.capacity ?? 0;

type Param = { type: "string" | "number" | "boolean"; required?: boolean; description: string; enum?: string[] };
export type CommandSpec = { description: string; params: Record<string, Param>; run: (s: ShopState, a: any) => unknown };

export function totals(s: ShopState) {
  const lines = s.cart.map((l) => { const p = product(l.product_id); return { ...l, name: p.name, unit_price: p.price, department: p.department, line_total: p.price * l.quantity }; });
  const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
  let discount = 0;
  const promo = s.promo ? promoOf(s.promo) : undefined;
  if (promo) {
    const base = promo.departments ? lines.filter((l) => promo.departments!.includes(l.department)).reduce((a, l) => a + l.line_total, 0) : subtotal;
    discount = subtotal >= promo.min_subtotal ? Math.round((base * promo.percent) / 100) : 0;
  }
  const fee = s.delivery ? (C.slots.find((x) => x.id === s.delivery!.slot_id)?.fee ?? 0) : 0;
  return { lines, subtotal, discount, delivery_fee: fee, total: subtotal - discount + fee };
}

export const COMMANDS: Record<string, CommandSpec> = {
  list_departments: { description: "List product departments.", params: {}, run: () => C.departments },
  search_products: {
    description: "Search the catalogue. All filters are optional; results are sorted by price, cheapest first.",
    params: {
      query: { type: "string", description: "Words to match in name, description or tags, e.g. 'surf', 'popper'." },
      department: { type: "string", description: "Department id (see list_departments)." },
      water: { type: "string", description: "Saltwater or freshwater use. 'both' products match either.", enum: ["salt", "fresh"] },
      max_price_fcfa: { type: "number", description: "Maximum unit price in FCFA." },
      in_stock_only: { type: "boolean", description: "Only return products currently in stock." },
    },
    run: (s, a) => {
      const words = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return C.products.filter((p) =>
        (!a.department || p.department === a.department) &&
        (!a.water || p.water === a.water || p.water === "both") &&
        (a.max_price_fcfa == null || p.price <= a.max_price_fcfa) &&
        (!a.in_stock_only || stockOf(s, p.id) > 0) &&
        words.every((w) => `${p.name} ${p.description} ${p.tags.join(" ")}`.toLowerCase().includes(w)),
      ).sort((x, y) => x.price - y.price).map((p) => view(s, p));
    },
  },
  get_product: { description: "Get one product by id.", params: { product_id: { type: "string", required: true, description: "Product id." } }, run: (s, a) => view(s, product(a.product_id)) },
  add_to_cart: {
    description: "Add a product to the cart (adds to any quantity already there).",
    params: { product_id: { type: "string", required: true, description: "Product id." }, quantity: { type: "number", required: true, description: "Units to add, 1 or more." } },
    run: (s, a) => {
      const p = product(a.product_id); const q = Number(a.quantity);
      if (!Number.isInteger(q) || q < 1) fail("bad_quantity", "quantity must be a whole number, 1 or more");
      const line = s.cart.find((l) => l.product_id === p.id); const want = (line?.quantity ?? 0) + q;
      if (want > stockOf(s, p.id)) fail("out_of_stock", `Only ${stockOf(s, p.id)} of '${p.name}' in stock.`);
      if (line) line.quantity = want; else s.cart.push({ product_id: p.id, quantity: q });
      return totals(s);
    },
  },
  set_cart_quantity: {
    description: "Set the quantity of a product already in the cart. 0 removes it.",
    params: { product_id: { type: "string", required: true, description: "Product id in the cart." }, quantity: { type: "number", required: true, description: "New quantity, 0 or more." } },
    run: (s, a) => {
      const line = s.cart.find((l) => l.product_id === a.product_id) ?? fail("not_in_cart", `'${a.product_id}' is not in the cart.`);
      const q = Number(a.quantity);
      if (!Number.isInteger(q) || q < 0) fail("bad_quantity", "quantity must be a whole number, 0 or more");
      if (q > stockOf(s, line.product_id)) fail("out_of_stock", `Only ${stockOf(s, line.product_id)} in stock.`);
      if (q === 0) s.cart = s.cart.filter((l) => l !== line); else line.quantity = q;
      return totals(s);
    },
  },
  view_cart: { description: "Show the cart with subtotal, discount, delivery fee and total in FCFA.", params: {}, run: (s) => ({ ...totals(s), promo: s.promo, delivery: s.delivery }) },
  apply_promo: {
    description: "Apply a promo code to the cart. Only one code at a time.",
    params: { code: { type: "string", required: true, description: "Promo code from list_promos." } },
    run: (s, a) => {
      const code = String(a.code).trim().toUpperCase();
      const promo = promoOf(code) ?? fail("invalid_promo", `'${a.code}' is not a valid code.`);
      const t = totals(s);
      if (t.subtotal < promo.min_subtotal) fail("promo_minimum", `${code} needs a subtotal of ${promo.min_subtotal} FCFA; cart is ${t.subtotal}.`);
      s.promo = code; return { applied: code, description: promo.description, ...totals(s) };
    },
  },
  list_promos: {
    description: "List current promo codes with their rules, and the discount each would give on the current cart (0 if it does not qualify).",
    params: {},
    run: (s) => C.promos.filter((p) => p.active).map((p) => {
      const t = totals({ ...s, promo: p.code });
      return { code: p.code, description: p.description, min_subtotal_fcfa: p.min_subtotal, departments: p.departments ?? "all", discount_on_current_cart_fcfa: t.discount };
    }),
  },
  list_delivery_slots: { description: "List delivery slots with fees and whether they are available.", params: {}, run: (s) => C.slots.map((x) => ({ id: x.id, day: x.day, window: x.window, fee_fcfa: x.fee, available: slotCap(s, x.id) > 0 })) },
  set_delivery: {
    description: "Choose a delivery slot and address (address is ignored for shop pickup).",
    params: { slot_id: { type: "string", required: true, description: "Slot id from list_delivery_slots." }, address: { type: "string", description: "Delivery address, e.g. 'Bonapriso, Douala'." } },
    run: (s, a) => {
      const slot = C.slots.find((x) => x.id === a.slot_id) ?? fail("bad_slot", `No slot '${a.slot_id}'.`);
      if (slotCap(s, slot.id) <= 0) fail("slot_full", `${slot.day} ${slot.window} is full.`);
      if (slot.id !== "pickup" && !String(a.address ?? "").trim()) fail("address_required", "An address is required for delivery.");
      s.delivery = { slot_id: slot.id, address: slot.id === "pickup" ? "Shop pickup, Bonanjo" : String(a.address).trim() };
      return { delivery: s.delivery, ...totals(s) };
    },
  },
  checkout: {
    description: "Place the order for the current cart, promo and delivery.",
    params: {
      payment: { type: "string", required: true, description: "How the customer pays.", enum: ["cash_on_delivery", "mobile_money"] },
      phone: { type: "string", description: "Mobile money number (required for mobile_money), 9 digits starting with 6." },
    },
    run: (s, a) => {
      if (!s.cart.length) fail("empty_cart", "The cart is empty.");
      const delivery = s.delivery ?? fail("no_delivery", "Choose a delivery slot first (set_delivery).");
      if (!["cash_on_delivery", "mobile_money"].includes(a.payment)) fail("bad_payment", "payment must be cash_on_delivery or mobile_money");
      if (a.payment === "mobile_money" && !/^6\d{8}$/.test(String(a.phone ?? "").replace(/\s/g, ""))) fail("bad_phone", "Mobile money needs a 9-digit number starting with 6.");
      for (const l of s.cart) if (l.quantity > stockOf(s, l.product_id)) fail("out_of_stock", `Not enough stock for ${l.product_id}.`);
      const t = totals(s);
      const order: Order = {
        id: `TT-${1001 + s.orders.length}`, lines: t.lines.map(({ product_id, quantity, name, unit_price }) => ({ product_id, quantity, name, unit_price })),
        subtotal: t.subtotal, discount: t.discount, delivery_fee: t.delivery_fee, total: t.total, promo: s.promo,
        slot_id: delivery.slot_id, address: delivery.address, payment: a.payment,
        phone: a.payment === "mobile_money" ? String(a.phone).replace(/\s/g, "") : null, status: "placed",
      };
      for (const l of s.cart) s.stock[l.product_id] = stockOf(s, l.product_id) - l.quantity;
      s.slot_capacity[order.slot_id] = slotCap(s, order.slot_id) - 1;
      s.orders.push(order); s.cart = []; s.promo = null; s.delivery = null;
      return order;
    },
  },
  list_orders: { description: "List orders placed in this session.", params: {}, run: (s) => s.orders },
};

/** Run a command by name with validation of required params. Returns { ok, result } or { ok: false, error }. */
export function call(s: ShopState, name: string, args: Record<string, unknown> = {}) {
  const spec = COMMANDS[name];
  if (!spec) return { ok: false, error: { code: "unknown_command", message: `Unknown command '${name}'. Commands: ${Object.keys(COMMANDS).join(", ")}` } };
  for (const [k, p] of Object.entries(spec.params)) {
    if (p.required && (args[k] === undefined || args[k] === null || args[k] === "")) return { ok: false, error: { code: "missing_param", message: `'${k}' is required` } };
    if (args[k] !== undefined && p.enum && !p.enum.includes(String(args[k]))) return { ok: false, error: { code: "bad_param", message: `'${k}' must be one of ${p.enum.join(", ")}` } };
  }
  try { return { ok: true, result: spec.run(s, args) }; }
  catch (e) { return e instanceof CommandError ? { ok: false, error: { code: e.code, message: e.message } } : { ok: false, error: { code: "internal", message: String(e) } }; }
}

export const describe = () => Object.entries(COMMANDS).map(([name, c]) => ({ name, description: c.description, params: c.params }));
