// The app's live content: everything an owner can change from the admin without a code release.
export type Department = { id: string; name: string };
export type Product = {
  id: string; name: string; department: string; price: number; stock: number;
  water: "salt" | "fresh" | "both"; tags: string[]; description: string; image_url?: string;
};
export type Promo = { code: string; percent: number; min_subtotal: number; departments?: string[]; description: string; active: boolean };
export type Slot = { id: string; day: string; window: string; fee: number; capacity: number };
export type Action = { screen: "home" | "search" | "product" | "cart" | "orders"; params?: Record<string, string | number | boolean> };

/** Home screen blocks: a small, safe vocabulary the admin can arrange. */
export type Block =
  | { id: string; type: "hero"; title: string; body?: string; color?: string }
  | { id: string; type: "banner"; text: string; tone: "info" | "success" | "warning" | "critical"; action?: Action }
  | { id: string; type: "departments"; title: string }
  | { id: string; type: "product_rail"; title: string; filter: { department?: string; tag?: string; water?: "salt" | "fresh"; max_price?: number; in_stock_only?: boolean }; limit: number }
  | { id: string; type: "promos"; title: string }
  | { id: string; type: "text"; text: string; role: "title" | "body" | "caption" }
  | { id: string; type: "button"; label: string; action: Action };

export type AppContent = {
  schema_version: "1.0"; app_id: string; version: number; published_at: string;
  brand: { name: string; tagline: string };
  theme: { accent: string };
  departments: Department[]; products: Product[]; promos: Promo[]; slots: Slot[];
  screens: { home: Block[] };
};
