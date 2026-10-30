// Tide & Tackle shop UI. Every action goes through the same typed commands an agent uses (src/domain/shop.ts),
// and every interactive element has an accessibility label, so the screen is as readable to an agent as to a person.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { device, type PaymentRequest } from "@shipvo/device";
import { ScanScreen, PaymentSheet, locateCustomer } from "./Native";
import type { Action, AppContent, Block, Product } from "../content/types";
import { call, initialState, stockOf, totals, type Order, type ShopState } from "../domain/shop";
import { fcfa, type Tokens } from "./theme";

export type Route =
  | { screen: "home" } | { screen: "search"; query?: string; department?: string }
  | { screen: "product"; id: string } | { screen: "cart" } | { screen: "checkout" }
  | { screen: "done"; order: Order } | { screen: "orders" } | { screen: "about" } | { screen: "scan" };

type Ctx = {
  T: Tokens; s: ReturnType<typeof styles>; content: AppContent; shop: ShopState;
  run: (name: string, args?: Record<string, unknown>) => { ok: boolean; result?: any; error?: { code: string; message: string } };
  go: (r: Route) => void; back: () => void; onOrder?: (o: Order) => void;
  /** While a sheet is open, everything behind it is hidden from assistive tech (and so from agents), on every platform. */
  setSheetOpen: (open: boolean) => void; sheetOpen: boolean;
};

export function useShop() {
  const ref = useRef<ShopState>((() => {
    const st = initialState();
    const seed = (globalThis as any).__PN_SIM__?.seed_cart; // simulator only: start a session with items in the cart
    if (Array.isArray(seed)) st.cart = seed.map((l: any) => ({ product_id: String(l.product_id), quantity: Number(l.quantity) }));
    return st;
  })());
  const [, bump] = useState(0);
  const run = (name: string, args: Record<string, unknown> = {}) => { const r = call(ref.current, name, args); bump((n) => n + 1); return r as any; };
  return { shop: ref.current, run };
}

export function ShopApp({ T, content, about, onOrder }: { T: Tokens; content: AppContent; about: ReactNode; onOrder?: (o: Order) => void }) {
  const s = useMemo(() => styles(T), [T]);
  const { shop, run } = useShop();
  const [stack, setStack] = useState<Route[]>([{ screen: "home" }]);
  const route = stack[stack.length - 1];
  const go = (r: Route) => setStack((st) => [...st, r]);
  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
  const [sheetOpen, setSheetOpen] = useState(false);
  const ctx: Ctx = { T, s, content, shop, run, go, back, onOrder, sheetOpen, setSheetOpen };
  const behind = sheetOpen ? ("no-hide-descendants" as const) : ("auto" as const);
  const cartCount = shop.cart.reduce((a, l) => a + l.quantity, 0);
  const [online, setOnline] = useState(device.net.online());
  useEffect(() => device.net.onChange(setOnline), []);
  useEffect(() => device.notifications.onOpen(() => setStack((st) => [...st, { screen: "orders" }])), []);
  const onScanned = (code: string) => {
    const r = run("find_by_barcode", { code });
    setStack((st) => st.slice(0, -1)); // leave the scanner
    if (r.ok) go({ screen: "product", id: r.result.id }); else go({ screen: "search", query: code });
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.surface }}>
      <View style={s.topbar} importantForAccessibility={behind}>
        {stack.length > 1
          ? <Btn ctx={ctx} label="Back" onPress={back} kind="ghost" small />
          : <Text style={s.brand} accessibilityRole="header">{content.brand.name}</Text>}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn ctx={ctx} label="Scan" a11y="Scan a product barcode" onPress={() => go({ screen: "scan" })} kind="ghost" small />
          <Btn ctx={ctx} label="Search" a11y="Open search" onPress={() => go({ screen: "search" })} kind="ghost" small />
          <Btn ctx={ctx} label={`Cart (${cartCount})`} a11y={`Open cart, ${cartCount} items`} onPress={() => go({ screen: "cart" })} kind="ghost" small />
        </View>
      </View>
      {!online && <Text style={s.offline} accessibilityLiveRegion="polite">You're offline. Prices may be out of date; orders will be sent when you're back.</Text>}
      {route.screen === "home" && <Home ctx={ctx} />}
      {route.screen === "scan" && <ScanScreen T={T} prompt="Point the camera at the barcode on the pack." onCode={onScanned} onCancel={back} />}
      {route.screen === "search" && <Search ctx={ctx} initial={route} key={JSON.stringify(route)} />}
      {route.screen === "product" && <ProductScreen ctx={ctx} id={route.id} />}
      {route.screen === "cart" && <Cart ctx={ctx} />}
      {route.screen === "checkout" && <Checkout ctx={ctx} />}
      {route.screen === "done" && <Done ctx={ctx} order={route.order} />}
      {route.screen === "orders" && <Orders ctx={ctx} />}
      {route.screen === "about" && <ScrollView contentContainerStyle={s.page}>{about}</ScrollView>}
    </View>
  );
}

function actionToRoute(a: Action): Route {
  if (a.screen === "search") return { screen: "search", query: a.params?.query as string | undefined, department: a.params?.department as string | undefined };
  if (a.screen === "product") return { screen: "product", id: String(a.params?.id ?? "") };
  return { screen: a.screen } as Route;
}

/* ---------- home: rendered from admin-editable blocks ---------- */
function Home({ ctx }: { ctx: Ctx }) {
  const { s, content, go } = ctx;
  return (
    <ScrollView contentContainerStyle={s.page} accessibilityLabel="Home">
      {content.screens.home.map((b) => <BlockView key={b.id} b={b} ctx={ctx} />)}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Btn ctx={ctx} label="My orders" onPress={() => go({ screen: "orders" })} kind="ghost" small />
        <Btn ctx={ctx} label="About this build" onPress={() => go({ screen: "about" })} kind="ghost" small />
      </View>
      <Text style={s.caption}>Content v{content.version}</Text>
    </ScrollView>
  );
}

function BlockView({ b, ctx }: { b: Block; ctx: Ctx }) {
  const { s, T, content, shop, go } = ctx;
  switch (b.type) {
    case "hero":
      return (
        <View style={[s.hero, { backgroundColor: b.color || T.accent }]} accessibilityRole="summary">
          <Text style={s.heroTitle} accessibilityRole="header">{b.title}</Text>
          {!!b.body && <Text style={s.heroBody}>{b.body}</Text>}
        </View>
      );
    case "banner": {
      const tone = { info: [T.info, T.infoSoft], success: [T.success, T.successSoft], warning: [T.warning, T.warningSoft], critical: [T.critical, T.criticalSoft] }[b.tone];
      const inner = <View style={[s.banner, { backgroundColor: tone[1], borderColor: tone[0] }]}><Text style={[s.bannerText, { color: tone[0] }]}>{b.text}</Text></View>;
      return b.action
        ? <Pressable accessibilityRole="button" accessibilityLabel={b.text} testID={`banner-${b.id}`} onPress={() => go(actionToRoute(b.action!))}>{inner}</Pressable>
        : inner;
    }
    case "departments":
      return (
        <View style={{ gap: 10 }}>
          <Text style={s.h2} accessibilityRole="header">{b.title}</Text>
          <View style={s.chips}>
            {content.departments.map((d) => (
              <Pressable key={d.id} style={s.chip} accessibilityRole="button" accessibilityLabel={`Department ${d.name}`} testID={`dept-${d.id}`} onPress={() => go({ screen: "search", department: d.id })}>
                <Text style={s.chipText}>{d.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      );
    case "product_rail": {
      const r = call(shop, "search_products", { department: b.filter.department, query: b.filter.tag, water: b.filter.water, max_price_fcfa: b.filter.max_price, in_stock_only: b.filter.in_stock_only });
      const items: any[] = r.ok ? (r.result as any[]).slice(0, b.limit) : [];
      return (
        <View style={{ gap: 10 }}>
          <Text style={s.h2} accessibilityRole="header">{b.title}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} accessibilityLabel={`${b.title}, ${items.length} products`}>
            {items.map((p) => <ProductTile key={p.id} p={p} ctx={ctx} />)}
          </ScrollView>
        </View>
      );
    }
    case "promos":
      return (
        <View style={{ gap: 8 }}>
          <Text style={s.h2} accessibilityRole="header">{b.title}</Text>
          {content.promos.filter((p) => p.active).map((p) => (
            <View key={p.code} style={s.row}><Text style={s.code}>{p.code}</Text><Text style={[s.body, { flex: 1 }]}>{p.description}</Text></View>
          ))}
        </View>
      );
    case "text":
      return <Text style={b.role === "title" ? s.h2 : b.role === "caption" ? s.caption : s.body}>{b.text}</Text>;
    case "button":
      return <Btn ctx={ctx} label={b.label} onPress={() => go(actionToRoute(b.action))} />;
  }
}

function Thumb({ p, ctx, size }: { p: { image_url?: string | null; name: string; department: string }; ctx: Ctx; size: number }) {
  const { T } = ctx;
  if (p.image_url) return <Image source={{ uri: p.image_url }} style={{ width: size, height: size, borderRadius: 10 }} accessibilityIgnoresInvertColors accessible={false} />;
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: T.sunken, alignItems: "center", justifyContent: "center" }} accessible={false}>
      <Text style={{ color: T.text2, fontWeight: "700", fontSize: size / 5, textTransform: "uppercase" }}>{p.department.slice(0, 4)}</Text>
    </View>
  );
}

function ProductTile({ p, ctx }: { p: any; ctx: Ctx }) {
  const { s, go } = ctx;
  return (
    <Pressable style={s.tile} onPress={() => go({ screen: "product", id: p.id })} accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${fcfa(p.price_fcfa)}${p.in_stock ? "" : ", out of stock"}`} testID={`product-${p.id}`}>
      <Thumb p={p} ctx={ctx} size={120} />
      <Text style={s.tileName} numberOfLines={2}>{p.name}</Text>
      <Text style={s.price}>{fcfa(p.price_fcfa)}</Text>
    </Pressable>
  );
}

/* ---------- search ---------- */
function Search({ ctx, initial }: { ctx: Ctx; initial: { query?: string; department?: string } }) {
  const { s, T, content, run, go } = ctx;
  const [q, setQ] = useState(initial.query ?? "");
  const [dept, setDept] = useState<string | undefined>(initial.department);
  const [inStock, setInStock] = useState(false);
  const r = call(ctx.shop, "search_products", { query: q, department: dept, in_stock_only: inStock });
  const items: any[] = r?.ok ? (r.result as any[]) : [];
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets accessibilityLabel="Search">
      <TextInput value={q} onChangeText={setQ} placeholder="Search rods, lures, line…" placeholderTextColor={T.text2}
        style={s.input} accessibilityLabel="Search products" testID="search-input" autoCorrect={false} returnKeyType="search" />
      <View style={s.chips}>
        <Chip ctx={ctx} label="All" on={!dept} onPress={() => setDept(undefined)} />
        {content.departments.map((d) => <Chip key={d.id} ctx={ctx} label={d.name} on={dept === d.id} onPress={() => setDept(d.id)} />)}
        <Chip ctx={ctx} label="In stock only" on={inStock} onPress={() => setInStock(!inStock)} />
      </View>
      <Text style={s.caption} accessibilityLiveRegion="polite">{items.length} results, cheapest first</Text>
      {items.map((p) => (
        <Pressable key={p.id} style={s.listItem} onPress={() => go({ screen: "product", id: p.id })} accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${fcfa(p.price_fcfa)}, ${p.in_stock ? `${p.stock} in stock` : "out of stock"}`} testID={`result-${p.id}`}>
          <Thumb p={p} ctx={ctx} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.itemTitle}>{p.name}</Text>
            <Text style={s.caption}>{p.water === "both" ? "Salt & fresh" : p.water === "salt" ? "Saltwater" : "Freshwater"} · {p.in_stock ? `${p.stock} in stock` : "Out of stock"}</Text>
          </View>
          <Text style={s.price}>{fcfa(p.price_fcfa)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Chip({ ctx, label, on, onPress, kind = "filter" }: { ctx: Ctx; label: string; on: boolean; onPress: () => void; kind?: "filter" | "choice" }) {
  const { s, T } = ctx;
  return (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: T.accent, borderColor: T.accent }]} accessibilityRole="button"
      accessibilityState={{ selected: on }} accessibilityLabel={kind === "filter" ? `Filter ${label}` : label} testID={`${kind}-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <Text style={[s.chipText, on && { color: T.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

/* ---------- product ---------- */
function ProductScreen({ ctx, id }: { ctx: Ctx; id: string }) {
  const { s, T, run, go } = ctx;
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const r = call(ctx.shop, "get_product", { product_id: id });
  if (!r.ok) return <View style={s.page}><Text style={s.body}>Product not found.</Text></View>;
  const p: any = r.result;
  return (
    <ScrollView contentContainerStyle={s.page} accessibilityLabel={`Product ${p.name}`}>
      <Thumb p={p} ctx={ctx} size={220} />
      <Text style={s.h1} accessibilityRole="header">{p.name}</Text>
      <Text style={s.priceLg}>{fcfa(p.price_fcfa)}</Text>
      <Text style={[s.caption, { color: p.in_stock ? T.success : T.critical }]}>{p.in_stock ? `${p.stock} in stock` : "Out of stock"}</Text>
      <Text style={s.body}>{p.description}</Text>
      <Text style={s.caption}>{p.water === "both" ? "Salt & fresh water" : p.water === "salt" ? "Saltwater" : "Freshwater"} · {p.tags.join(", ")}</Text>
      {p.in_stock && (
        <View style={s.qtyRow}>
          <Btn ctx={ctx} label="−" a11y="Decrease quantity" onPress={() => setQty((q) => Math.max(1, q - 1))} kind="ghost" small />
          <Text style={s.qty} accessibilityLabel={`Quantity ${qty}`} testID="qty">{qty}</Text>
          <Btn ctx={ctx} label="+" a11y="Increase quantity" onPress={() => setQty((q) => Math.min(p.stock, q + 1))} kind="ghost" small />
        </View>
      )}
      <Btn ctx={ctx} label={p.in_stock ? `Add ${qty} to cart` : "Out of stock"} a11y={p.in_stock ? `Add ${qty} to cart` : "Out of stock"} disabled={!p.in_stock}
        onPress={() => { const res = run("add_to_cart", { product_id: p.id, quantity: qty }); setMsg(res.ok ? { ok: true, text: `Added ${qty} to cart` } : { ok: false, text: res.error!.message }); }} />
      {msg && <Text style={[s.body, { color: msg.ok ? T.success : T.critical }]} accessibilityLiveRegion="polite">{msg.text}</Text>}
      {msg?.ok && <Btn ctx={ctx} label="Go to cart" onPress={() => go({ screen: "cart" })} kind="ghost" />}
    </ScrollView>
  );
}

/* ---------- cart ---------- */
function Cart({ ctx }: { ctx: Ctx }) {
  const { s, T, shop, run, go } = ctx;
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const t = totals(shop);
  const promos = (call(shop, "list_promos").result as any[]) ?? [];
  if (!shop.cart.length) return (
    <View style={s.page}><Text style={s.h1} accessibilityRole="header">Your cart is empty</Text>
      <Text style={s.body}>Find gear for your next trip.</Text>
      <Btn ctx={ctx} label="Browse products" onPress={() => go({ screen: "search" })} /></View>
  );
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets accessibilityLabel="Cart">
      <Text style={s.h1} accessibilityRole="header">Cart</Text>
      {t.lines.map((l) => (
        <View key={l.product_id} style={s.listItem} accessibilityLabel={`${l.name}, quantity ${l.quantity}, ${fcfa(l.line_total)}`}>
          <View style={{ flex: 1, gap: 2 }}><Text style={s.itemTitle}>{l.name}</Text><Text style={s.caption}>{fcfa(l.unit_price)} each</Text></View>
          <Btn ctx={ctx} label="−" a11y={`Decrease ${l.name}`} small kind="ghost" onPress={() => run("set_cart_quantity", { product_id: l.product_id, quantity: l.quantity - 1 })} />
          <Text style={s.qty}>{l.quantity}</Text>
          <Btn ctx={ctx} label="+" a11y={`Increase ${l.name}`} small kind="ghost" onPress={() => { const r = run("set_cart_quantity", { product_id: l.product_id, quantity: l.quantity + 1 }); if (!r.ok) setMsg({ ok: false, text: r.error!.message }); }} />
        </View>
      ))}
      <Text style={s.h2} accessibilityRole="header">Promo code</Text>
      {promos.map((p) => (
        <Text key={p.code} style={s.caption}>{p.code}: {p.description}{p.discount_on_current_cart_fcfa ? ` (saves ${fcfa(p.discount_on_current_cart_fcfa)} now)` : ""}</Text>
      ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={code} onChangeText={setCode} placeholder="Code" placeholderTextColor={T.text2} autoCapitalize="characters"
          style={[s.input, { flex: 1 }]} accessibilityLabel="Promo code" testID="promo-input" />
        <Btn ctx={ctx} label="Apply" a11y="Apply promo code" onPress={() => { const r = run("apply_promo", { code }); setMsg(r.ok ? { ok: true, text: `${r.result.applied} applied` } : { ok: false, text: r.error!.message }); }} />
      </View>
      {msg && <Text style={[s.body, { color: msg.ok ? T.success : T.critical }]} accessibilityLiveRegion="polite">{msg.text}</Text>}
      <Totals ctx={ctx} />
      <Btn ctx={ctx} label="Choose delivery and pay" onPress={() => go({ screen: "checkout" })} />
    </ScrollView>
  );
}

function Totals({ ctx, slotFee }: { ctx: Ctx; slotFee?: number | null }) {
  const { s, shop } = ctx;
  const t0 = totals(shop);
  // On checkout, show the fee of the slot being chosen before the order is placed.
  const fee = slotFee != null ? slotFee : t0.delivery_fee;
  const t = { ...t0, delivery_fee: fee, total: t0.subtotal - t0.discount + fee };
  return (
    <View style={s.card} accessibilityLabel={`Total ${fcfa(t.total)}`}>
      <Line ctx={ctx} k="Subtotal" v={fcfa(t.subtotal)} />
      {t.discount > 0 && <Line ctx={ctx} k={`Discount (${shop.promo})`} v={`− ${fcfa(t.discount)}`} />}
      {(shop.delivery || slotFee != null) && <Line ctx={ctx} k="Delivery" v={t.delivery_fee ? fcfa(t.delivery_fee) : "Free"} />}
      <Line ctx={ctx} k="Total" v={fcfa(t.total)} strong />
    </View>
  );
}
function Line({ ctx, k, v, strong }: { ctx: Ctx; k: string; v: string; strong?: boolean }) {
  const { s } = ctx;
  return <View style={s.row}><Text style={[s.body, { flex: 1 }, strong && s.strong]}>{k}</Text><Text style={[s.body, strong && s.strong]}>{v}</Text></View>;
}

/* ---------- checkout ---------- */
function Checkout({ ctx }: { ctx: Ctx }) {
  const { s, T, shop, run, go, content, onOrder } = ctx;
  const slots = (call(shop, "list_delivery_slots").result as any[]) ?? [];
  const [slot, setSlot] = useState<string | null>(shop.delivery?.slot_id ?? null);
  const [address, setAddress] = useState(shop.delivery?.address ?? "");
  const [payment, setPayment] = useState<"cash_on_delivery" | "mobile_money">("cash_on_delivery");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false); const [near, setNear] = useState<string | null>(null);
  const [payReq, setPayReqState] = useState<PaymentRequest | null>(null);
  const setPayReq = (r: PaymentRequest | null) => { setPayReqState(r); ctx.setSheetOpen(!!r); };
  const t = totals(shop);
  const fee = slot ? (slots.find((x) => x.id === slot)?.fee_fcfa ?? 0) : 0;
  const total = t.subtotal - t.discount + fee;
  const useLocation = async () => {
    setLocating(true); setErr(null);
    const r = await locateCustomer(); setLocating(false);
    if ("error" in r) return setErr(r.error);
    setAddress(r.address);
    setNear(r.kmToShop <= 1.5 ? `You're ${r.kmToShop} km from the shop: pickup is free and ready in 20 minutes.` : `You're ${r.kmToShop} km from the shop.`);
  };
  const finish = (receipt?: string) => {
    const o = run("checkout", { payment, phone, receipt });
    if (!o.ok) return setErr(o.error!.message);
    onOrder?.(o.result); go({ screen: "done", order: o.result });
    device.notifications.show({ title: `Order ${o.result.id} confirmed`, body: `${content.brand.name} is preparing your order. Total ${fcfa(o.result.total)}.`, data: { order: o.result.id } }).catch(() => {});
  };
  const place = async () => {
    if (!slot) return setErr("Choose a delivery slot");
    const d = run("set_delivery", { slot_id: slot, address });
    if (!d.ok) return setErr(d.error!.message);
    if (payment !== "mobile_money") return finish();
    if (!/^6\d{8}$/.test(phone.replace(/\s/g, ""))) return setErr("Mobile money needs a 9-digit number starting with 6.");
    // A person confirms with their fingerprint, then approves the charge with their mobile money PIN.
    if (await device.auth.available()) {
      const a = await device.auth.confirm(`Confirm payment of ${fcfa(total)} to ${content.brand.name}`);
      if (!a.ok) return setErr(a.reason === "cancelled" ? "Payment not confirmed." : "Fingerprint not recognised. Try again.");
    }
    setErr(null); setPayReq({ provider: "mobile_money", amount: total, currency: "FCFA", to: content.brand.name, reference: `TT-${1001 + shop.orders.length}`, phone: phone.replace(/\s/g, "") });
  };
  return (
    <>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets accessibilityLabel="Checkout" importantForAccessibility={payReq ? "no-hide-descendants" : "auto"}>
      <Text style={s.h1} accessibilityRole="header">Delivery and payment</Text>
      <Text style={s.h2} accessibilityRole="header">Delivery slot</Text>
      {slots.map((x) => (
        <Pressable key={x.id} disabled={!x.available} onPress={() => setSlot(x.id)} accessibilityRole="radio"
          accessibilityState={{ selected: slot === x.id, disabled: !x.available }} accessibilityLabel={`${x.day} ${x.window}, ${x.fee_fcfa ? fcfa(x.fee_fcfa) : "free"}${x.available ? "" : ", full"}`}
          testID={`slot-${x.id}`} style={[s.listItem, slot === x.id && { borderColor: T.accent, borderWidth: 2 }, !x.available && { opacity: 0.45 }]}>
          <View style={{ flex: 1 }}><Text style={s.itemTitle}>{x.day} · {x.window}</Text><Text style={s.caption}>{x.available ? (x.fee_fcfa ? fcfa(x.fee_fcfa) : "Free") : "Full"}</Text></View>
          <Text style={s.body}>{slot === x.id ? "Selected" : ""}</Text>
        </Pressable>
      ))}
      <Btn ctx={ctx} label={locating ? "Finding you…" : "Use my location"} a11y="Use my location" onPress={useLocation} kind="ghost" disabled={locating} />
      {near && <Text style={s.body} accessibilityLiveRegion="polite">{near}</Text>}
      {slot !== "pickup" && (
        <TextInput value={address} onChangeText={setAddress} placeholder="Delivery address, e.g. Bonapriso, Douala" placeholderTextColor={T.text2}
          style={s.input} accessibilityLabel="Delivery address" testID="address-input" />
      )}
      <Text style={s.h2} accessibilityRole="header">Payment</Text>
      <View style={s.chips}>
        <Chip ctx={ctx} label={slot === "pickup" ? "Cash at pickup" : "Cash on delivery"} on={payment === "cash_on_delivery"} onPress={() => setPayment("cash_on_delivery")} kind="choice" />
        <Chip ctx={ctx} label="Mobile money" on={payment === "mobile_money"} onPress={() => setPayment("mobile_money")} kind="choice" />
      </View>
      {payment === "mobile_money" && (
        <TextInput value={phone} onChangeText={setPhone} placeholder="6XX XX XX XX" placeholderTextColor={T.text2} keyboardType="phone-pad"
          style={s.input} accessibilityLabel="Mobile money number" testID="phone-input" />
      )}
      <Totals ctx={ctx} slotFee={slot ? (slots.find((x) => x.id === slot)?.fee_fcfa ?? 0) : null} />
      {err && <Text style={[s.body, { color: T.critical }]} accessibilityLiveRegion="assertive">{err}</Text>}
      <Btn ctx={ctx} label={payment === "mobile_money" ? "Pay and place order" : "Place order"} a11y="Place order" onPress={place} />
      <Text style={s.caption}>{content.brand.name} delivers in Douala. {payment === "mobile_money" ? "You confirm the mobile money payment in the app." : "Pay in cash when you receive your order."}</Text>
    </ScrollView>
    {payReq && <PaymentSheet T={T} req={payReq} onCancel={() => { setPayReq(null); setErr("Payment cancelled."); }} onDone={(r) => { setPayReq(null); finish(r.ok ? r.receipt : undefined); }} />}
    </>
  );
}

function Done({ ctx, order }: { ctx: Ctx; order: Order }) {
  const { s, go } = ctx;
  return (
    <ScrollView contentContainerStyle={s.page} accessibilityLabel="Order placed">
      <Text style={s.h1} accessibilityRole="header">Order {order.id} placed</Text>
      {order.lines.map((l) => <Text key={l.product_id} style={s.body}>{l.quantity} × {l.name}</Text>)}
      <Text style={s.body}>Total {fcfa(order.total)}{order.promo ? ` (with ${order.promo})` : ""}</Text>
      <Text style={s.caption}>{order.address} · {order.payment === "mobile_money" ? `Mobile money ${order.phone}${order.receipt ? `, paid (${order.receipt})` : ""}` : order.slot_id === "pickup" ? "Cash at pickup" : "Cash on delivery"}</Text>
      <Btn ctx={ctx} label="Share order" kind="ghost" onPress={() => device.share.text(`Order ${order.id} at Tide & Tackle: ${order.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}. Total ${fcfa(order.total)}.`, `Order ${order.id}`)} />
      <Btn ctx={ctx} label="Back to shop" onPress={() => go({ screen: "home" })} />
    </ScrollView>
  );
}

function Orders({ ctx }: { ctx: Ctx }) {
  const { s, shop } = ctx;
  return (
    <ScrollView contentContainerStyle={s.page} accessibilityLabel="My orders">
      <Text style={s.h1} accessibilityRole="header">My orders</Text>
      {!shop.orders.length && <Text style={s.body}>No orders yet.</Text>}
      {shop.orders.map((o) => <Text key={o.id} style={s.body}>{o.id} · {fcfa(o.total)} · {o.lines.length} items</Text>)}
    </ScrollView>
  );
}

/* ---------- primitives ---------- */
function Btn({ ctx, label, a11y, onPress, kind = "primary", small, disabled }: { ctx: Ctx; label: string; a11y?: string; onPress: () => void; kind?: "primary" | "ghost"; small?: boolean; disabled?: boolean }) {
  const { s, T } = ctx;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ disabled: !!disabled }}
      testID={`btn-${(a11y ?? label).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      style={({ pressed }) => [small ? s.btnSm : s.btn, kind === "primary" ? { backgroundColor: T.accent } : s.btnGhost, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[s.btnText, kind === "ghost" && { color: T.text }, small && { fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = (T: Tokens) => StyleSheet.create({
  topbar: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.surface },
  brand: { fontSize: 17, fontWeight: "800", color: T.text },
  page: { padding: 16, gap: 14, paddingBottom: 48 },
  offline: { backgroundColor: "#8A5A00", color: "#FFFFFF", paddingVertical: 8, paddingHorizontal: 16, fontSize: 13, fontWeight: "600" },
  hero: { borderRadius: 16, padding: 22, gap: 8 },
  heroTitle: { fontSize: 28, lineHeight: 34, fontWeight: "800", color: "#FFFFFF" },
  heroBody: { fontSize: 15, lineHeight: 21, color: "#FFFFFF", opacity: 0.9 },
  banner: { borderRadius: 12, borderWidth: 1, padding: 14 },
  bannerText: { fontSize: 15, fontWeight: "700" },
  h1: { fontSize: 24, fontWeight: "800", color: T.text },
  h2: { fontSize: 17, fontWeight: "700", color: T.text },
  body: { fontSize: 15, lineHeight: 21, color: T.text },
  strong: { fontWeight: "800" },
  caption: { fontSize: 13, color: T.text2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.raised },
  chipText: { fontSize: 14, fontWeight: "600", color: T.text },
  tile: { width: 140, gap: 6 },
  tileName: { fontSize: 14, fontWeight: "600", color: T.text },
  price: { fontSize: 14, fontWeight: "700", color: T.text },
  priceLg: { fontSize: 22, fontWeight: "800", color: T.text },
  listItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.raised },
  itemTitle: { fontSize: 15, fontWeight: "700", color: T.text },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: T.border, paddingHorizontal: 14, color: T.text, backgroundColor: T.raised, fontSize: 16 },
  card: { borderRadius: 12, padding: 14, gap: 6, backgroundColor: T.raised, borderWidth: 1, borderColor: T.border },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  code: { fontWeight: "800", color: T.accent, fontSize: 14, minWidth: 72 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  qty: { fontSize: 18, fontWeight: "800", color: T.text, minWidth: 24, textAlign: "center" },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnSm: { minHeight: 44, minWidth: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  btnGhost: { borderWidth: 1, borderColor: T.border, backgroundColor: "transparent" },
  btnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
