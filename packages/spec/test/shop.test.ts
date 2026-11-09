import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, toolsFromSpec, unlabelled, validate } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("../../../templates/shop/app.json", import.meta.url), "utf8"));
const NOW = "2026-11-10T12:00:00Z";

function phoneStorage() {
  const rows = new Map<string, string>();
  return {
    get: (key: string) => (rows.has(key) ? JSON.parse(rows.get(key)!) : undefined),
    put: (key: string, value: unknown) => void rows.set(key, JSON.stringify(value)),
  };
}

function callTool(store: ReturnType<typeof phoneStorage>, tool: string, input: Record<string, unknown>) {
  const t = toolsFromSpec(spec).find((x) => x.name === tool);
  if (!t) throw new Error(`no tool ${tool}`);
  const r = createApp(spec, { data: store.get("data"), now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const out = r.app.call(t.action, input) as any;
  if (out.ok) store.put("data", { settings: r.app.data.settings, products: r.app.data.products, orders: r.app.data.orders });
  return out;
}

function stocked() {
  const store = phoneStorage();
  callTool(store, "add_product", { name: "Blue mug", price: 12.5, stock: 5, photo: "a blue mug on a shelf" });
  callTool(store, "add_product", { name: "Tea towel", price: 8, stock: 2 });
  return store;
}

describe("Shop spec app", () => {
  it("validates with no errors or warnings", () => {
    const v = validate(spec);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("generates the four typed actions", () => {
    const names = toolsFromSpec(spec).map((t) => t.name);
    for (const n of ["add_product", "find_products", "place_order", "list_orders"]) expect(names).toContain(n);
  });

  it("adds a product, places an order and lists it with the right total", () => {
    const store = phoneStorage();
    const added = callTool(store, "add_product", { name: "Blue mug", price: 12.5, stock: 5 });
    expect(added.ok).toBe(true);
    const order = callTool(store, "place_order", { productId: added.value.id, quantity: 3 });
    expect(order.value).toMatchObject({ total: 37.5, currency: "USD", status: "placed" });
    const listed = callTool(store, "list_orders", {}).value.orders;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: order.value.id, total: 37.5, currency: "USD", status: "placed", items: "3 x Blue mug" });
    expect(callTool(store, "find_products", {}).value.products[0].stock).toBe(2);
  });

  it("uses the currency setting, not dollars", () => {
    const store = stocked();
    expect(callTool(store, "set_currency", { currency: "eur" }).ok).toBe(true);
    const order = callTool(store, "place_order", { productId: "p2", quantity: 2 });
    expect(order.value).toMatchObject({ total: 16, currency: "EUR" });
    expect(callTool(store, "list_orders", {}).value.orders[0].currency).toBe("EUR");
    expect(callTool(store, "find_products", {}).value.currency).toBe("EUR");
  });

  it("rejects an order for a missing product, too much stock or zero", () => {
    const store = stocked();
    for (const i of [{ productId: "nope", quantity: 1 }, { productId: "p2", quantity: 3 }, { productId: "p1", quantity: 0 }]) {
      expect(callTool(store, "place_order", i).value).toMatchObject({ id: "", status: "rejected" });
    }
    expect(callTool(store, "list_orders", {}).value.orders).toEqual([]);
  });

  it("finds products and filters orders by status", () => {
    const store = stocked();
    callTool(store, "place_order", { productId: "p1", quantity: 1 });
    expect(callTool(store, "find_products", { text: "BLUE" }).value.products.map((p: any) => p.name)).toEqual(["Blue mug"]);
    expect(callTool(store, "find_products", { text: "shelf" }).value.products).toHaveLength(1);
    expect(callTool(store, "find_products", {}).value.products.map((p: any) => p.name)).toEqual(["Blue mug", "Tea towel"]);
    expect(callTool(store, "list_orders", { status: "placed" }).value.orders).toHaveLength(1);
    expect(callTool(store, "list_orders", { status: "shipped" }).value.orders).toEqual([]);
  });

  it("keeps ids unique and lists newest orders first", () => {
    const store = stocked();
    callTool(store, "place_order", { productId: "p1", quantity: 1 });
    callTool(store, "place_order", { productId: "p2", quantity: 1 });
    expect(callTool(store, "list_orders", {}).value.orders.map((o: any) => o.id)).toEqual(["o2", "o1"]);
  });

  for (const style of ["android", "ios"] as const) {
    for (const screen of ["catalogue", "orders"]) {
      it(`renders labelled elements on ${screen} on ${style}`, () => {
        const store = stocked();
        callTool(store, "place_order", { productId: "p1", quantity: 2 });
        const r = renderScreen(spec, { style, screen, data: store.get("data"), now: NOW });
        if (!r.ok) throw new Error(JSON.stringify(r.errors));
        expect(unlabelled(r.tree)).toEqual([]);
        const t = describeTree(r.tree);
        const want = screen === "catalogue" ? ['"Products"', "Blue mug", "Tea towel", '"New product form"'] : ['"Orders"', "2 x Blue mug", "placed"];
        for (const w of want) expect(t).toContain(w);
      });
    }
  }

  it("opens a product and takes an order through the forms", () => {
    const store = stocked();
    const r = createApp(spec, { data: store.get("data"), now: NOW });
    if (!r.ok) throw new Error("x");
    const app = r.app;
    expect(app.push("product", { id: "p1" }).ok).toBe(true);
    expect(describeTree(app.render().tree)).toContain("Blue mug");
    app.push("cart");
    expect(app.submit("Order form").ok).toBe(false);
    app.setField("Order form", "productId", "p1");
    app.setField("Order form", "quantity", 2);
    expect(app.submit("Order form").ok).toBe(true);
    expect(app.data.orders).toHaveLength(1);
  });
});
