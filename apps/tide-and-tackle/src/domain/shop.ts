// Tide & Tackle shop logic as typed commands. The same commands drive the app's screens and the headless agent
// surface, so whatever an agent can do here is exactly what a user can do in the app. Pure TypeScript, no React Native.
import { DEPARTMENTS, PRODUCTS, PROMOS, SLOTS, type Department, type Product } from "./catalog.ts";

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
  stock: Object.fromEntries(PRODUCTS.map((p) => [p.id, p.stock])),
  slot_capacity: Object.fromEntries(SLOTS.map((s) => [s.id, s.capacity])),
});

export class CommandError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const fail = (code: string, message: string): never => { throw new CommandError(code, message); };
const product = (id: string) => PRODUCTS.find((p) => p.id === id) ?? fail("not_found", `No product with id '${id}'. Use search_products to find ids.`);
const view = (s: ShopState, p: Product) => ({ id: p.id, name: p.name, department: p.department, price_fcfa: p.price, in_stock: s.stock[p.id] > 0, stock: s.stock[p.id], water: p.water, tags: p.tags, description: p.description });

type Param = { type: "string" | "number" | "boolean"; required?: boolean; description: string; enum?: string[] };
export type CommandSpec = { description: string; params: Record<string, Param>; run: (s: ShopState, a: any) => unknown };

function totals(s: ShopState) {
  const lines = s.cart.map((l) => { const p = product(l.product_id); return { ...l, name: p.name, unit_price: p.price, department: p.department, line_total: p.price * l.quantity }; });
  const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
  let discount = 0;
  if (s.promo) {
    const promo = PROMOS[s.promo];
    const base = promo.departments ? lines.filter((l) => promo.departments!.includes(l.department as Department)).reduce((a, l) => a + l.line_total, 0) : subtotal;
    discount = subtotal >= promo.minSubtotal ? Math.round((base * promo.percent) / 100) : 0;
  }
  const fee = s.delivery ? SLOTS.find((x) => x.id === s.delivery!.slot_id)!.fee : 0;
  return { lines, subtotal, discount, delivery_fee: fee, total: subtotal - discount + fee };
}

export const COMMANDS: Record<string, CommandSpec> = {
  list_departments: { description: "List product departments.", params: {}, run: () => DEPARTMENTS },
  search_products: {
    description: "Search the catalogue. All filters are optional; results are sorted by price, cheapest first.",
    params: {
      query: { type: "string", description: "Words to match in name, description or tags, e.g. 'surf', 'popper'." },
      department: { type: "string", description: "Department id.", enum: DEPARTMENTS.map((d) => d.id) },
      water: { type: "string", description: "Saltwater or freshwater use. 'both' products match either.", enum: ["salt", "fresh"] },
      max_price_fcfa: { type: "number", description: "Maximum unit price in FCFA." },
      in_stock_only: { type: "boolean", description: "Only return products currently in stock." },
    },
    run: (s, a) => {
      const words = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return PRODUCTS.filter((p) =>
        (!a.department || p.department === a.department) &&
        (!a.water || p.water === a.water || p.water === "both") &&
        (a.max_price_fcfa == null || p.price <= a.max_price_fcfa) &&
        (!a.in_stock_only || s.stock[p.id] > 0) &&
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
      if (want > s.stock[p.id]) fail("out_of_stock", `Only ${s.stock[p.id]} of '${p.name}' in stock.`);
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
      if (q > s.stock[line.product_id]) fail("out_of_stock", `Only ${s.stock[line.product_id]} in stock.`);
      if (q === 0) s.cart = s.cart.filter((l) => l !== line); else line.quantity = q;
      return totals(s);
    },
  },
  view_cart: { description: "Show the cart with subtotal, discount, delivery fee and total in FCFA.", params: {}, run: (s) => ({ ...totals(s), promo: s.promo, delivery: s.delivery }) },
  apply_promo: {
    description: "Apply a promo code to the cart. Only one code at a time.",
    params: { code: { type: "string", required: true, description: "Promo code, e.g. TIDE10." } },
    run: (s, a) => {
      const code = String(a.code).trim().toUpperCase();
      const promo = PROMOS[code] ?? fail("invalid_promo", `'${a.code}' is not a valid code.`);
      const t = totals(s);
      if (t.subtotal < promo.minSubtotal) fail("promo_minimum", `${code} needs a subtotal of ${promo.minSubtotal} FCFA; cart is ${t.subtotal}.`);
      s.promo = code; return { applied: code, description: promo.description, ...totals(s) };
    },
  },
  list_delivery_slots: { description: "List delivery slots with fees and whether they are available.", params: {}, run: (s) => SLOTS.map((x) => ({ id: x.id, day: x.day, window: x.window, fee_fcfa: x.fee, available: s.slot_capacity[x.id] > 0 })) },
  set_delivery: {
    description: "Choose a delivery slot and address (address is ignored for shop pickup).",
    params: { slot_id: { type: "string", required: true, description: "Slot id from list_delivery_slots." }, address: { type: "string", description: "Delivery address, e.g. 'Bonapriso, Douala'." } },
    run: (s, a) => {
      const slot = SLOTS.find((x) => x.id === a.slot_id) ?? fail("bad_slot", `No slot '${a.slot_id}'.`);
      if (s.slot_capacity[slot.id] <= 0) fail("slot_full", `${slot.day} ${slot.window} is full.`);
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
      for (const l of s.cart) if (l.quantity > s.stock[l.product_id]) fail("out_of_stock", `Not enough stock for ${l.product_id}.`);
      const t = totals(s);
      const order: Order = {
        id: `TT-${1001 + s.orders.length}`, lines: t.lines.map(({ product_id, quantity, name, unit_price }) => ({ product_id, quantity, name, unit_price })),
        subtotal: t.subtotal, discount: t.discount, delivery_fee: t.delivery_fee, total: t.total, promo: s.promo,
        slot_id: delivery.slot_id, address: delivery.address, payment: a.payment,
        phone: a.payment === "mobile_money" ? String(a.phone).replace(/\s/g, "") : null, status: "placed",
      };
      for (const l of s.cart) s.stock[l.product_id] -= l.quantity;
      s.slot_capacity[order.slot_id] -= 1;
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
