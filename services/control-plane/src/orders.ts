// Orders placed in an app. The control plane never trusts them: prices are recomputed from the published content,
// and an order stays `unverified` until the merchant's backend settles it with the owner token.
import type { AppContent } from "@shipvo/schema";

export type OrderStatus = "unverified" | "settled" | "price_mismatch" | "simulated";
export const RATE_PER_IP = 20;       // orders per minute per IP
export const RATE_PER_INSTALL = 10;  // orders per minute per install

/** Recompute an order from the content it names. Returns the reasons it does not match (empty = prices are right). */
export function checkPrices(o: any, content: AppContent | null): string[] {
  if (!content) return ["content version not found"];
  const bad: string[] = [];
  if (!o.lines.length) return ["no lines"];
  let subtotal = 0;
  const lines: { department: string; total: number }[] = [];
  for (const l of o.lines) {
    const p = content.products.find((x) => x.id === l?.product_id);
    if (!p) { bad.push(`unknown product ${String(l?.product_id).slice(0, 40)}`); continue; }
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000) { bad.push(`bad quantity for ${p.id}`); continue; }
    if (l.unit_price !== p.price) bad.push(`unit price of ${p.id} is ${p.price}, order says ${l.unit_price}`);
    subtotal += p.price * l.quantity; lines.push({ department: p.department, total: p.price * l.quantity });
  }
  if (bad.length) return bad;
  let discount = 0;
  if (o.promo) {
    const promo = content.promos.find((x) => x.code === o.promo && x.active);
    if (!promo) bad.push(`promo ${String(o.promo).slice(0, 20)} is not active`);
    else if (subtotal >= promo.min_subtotal) {
      const base = promo.departments ? lines.filter((l) => promo.departments!.includes(l.department)).reduce((a, l) => a + l.total, 0) : subtotal;
      discount = Math.round((base * promo.percent) / 100);
    }
  }
  let fee = 0;
  if (o.slot_id) {
    const slot = content.slots.find((x) => x.id === o.slot_id);
    if (!slot) bad.push(`unknown delivery slot ${String(o.slot_id).slice(0, 20)}`); else fee = slot.fee;
  }
  const total = subtotal - discount + fee;
  if (!bad.length && Math.round(o.total) !== total) bad.push(`total is ${total}, order says ${o.total}`);
  return bad;
}

/** The content the order names: a stored version, or the live content when it has that version. */
export async function contentFor(db: D1Database, kv: KVNamespace, appId: string, version: unknown): Promise<AppContent | null> {
  if (!Number.isInteger(version)) return null;
  try {
    const row = await db.prepare("SELECT json FROM content_versions WHERE app_id = ? AND version = ?").bind(appId, version).first<{ json: string }>();
    if (row) return JSON.parse(row.json);
    const live = await kv.get(`c/${appId}/content.json`);
    const c = live ? JSON.parse(live) : null;
    return c?.version === version ? c : null;
  } catch { return null; }
}

export async function sha(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
