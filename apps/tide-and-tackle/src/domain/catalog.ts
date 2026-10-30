// Tide & Tackle catalogue. Prices in FCFA (XAF). Pure data: shared by the app UI and the agent surface.
export type Department = "rods" | "reels" | "lines" | "lures" | "hooks" | "bait" | "apparel";
export type Product = {
  id: string; name: string; department: Department; price: number; stock: number;
  water: "salt" | "fresh" | "both"; tags: string[]; description: string;
};

export const DEPARTMENTS: { id: Department; name: string }[] = [
  { id: "rods", name: "Rods" }, { id: "reels", name: "Reels" }, { id: "lines", name: "Lines" },
  { id: "lures", name: "Lures" }, { id: "hooks", name: "Hooks" }, { id: "bait", name: "Bait" }, { id: "apparel", name: "Apparel" },
];

export const PRODUCTS: Product[] = [
  { id: "rod-surf-36", name: "Atlantic Surf Rod 3.6 m", department: "rods", price: 38000, stock: 4, water: "salt", tags: ["beach", "casting", "surf"], description: "Long surf rod for beach casting from Limbe and Kribi shores." },
  { id: "rod-surf-42", name: "Atlantic Surf Rod 4.2 m", department: "rods", price: 52000, stock: 2, water: "salt", tags: ["beach", "casting", "surf"], description: "Extra reach for heavy surf." },
  { id: "rod-spin-21", name: "Wouri Spinning Rod 2.1 m", department: "rods", price: 21000, stock: 9, water: "both", tags: ["spinning", "estuary"], description: "All-round rod for the Wouri estuary and lakes." },
  { id: "rod-boat-18", name: "Cap Boat Rod 1.8 m", department: "rods", price: 27500, stock: 0, water: "salt", tags: ["boat", "jigging"], description: "Stiff rod for boat jigging." },
  { id: "reel-ceymar-3000", name: "Okuma Ceymar 3000 Reel", department: "reels", price: 31000, stock: 0, water: "both", tags: ["spinning"], description: "Smooth spinning reel, 3000 size." },
  { id: "reel-spin-3000", name: "Coastline Spin 3000 Reel", department: "reels", price: 24500, stock: 6, water: "both", tags: ["spinning"], description: "Sealed spinning reel, 3000 size." },
  { id: "reel-surf-6000", name: "Breaker 6000 Surf Reel", department: "reels", price: 43000, stock: 3, water: "salt", tags: ["surf", "casting", "beach"], description: "Big-spool reel for surf casting." },
  { id: "reel-spin-2500", name: "Lakeside 2500 Reel", department: "reels", price: 16500, stock: 11, water: "fresh", tags: ["spinning"], description: "Light reel for freshwater." },
  { id: "line-mono-salt-30", name: "SaltGuard Mono 0.30 mm, 300 m", department: "lines", price: 6500, stock: 20, water: "salt", tags: ["mono"], description: "UV and salt resistant monofilament." },
  { id: "line-braid-salt-20", name: "Kribi Braid 20 lb, 150 m", department: "lines", price: 11000, stock: 7, water: "salt", tags: ["braid"], description: "Thin, strong braid for saltwater." },
  { id: "line-mono-fresh-25", name: "Lake Mono 0.25 mm, 200 m", department: "lines", price: 3500, stock: 15, water: "fresh", tags: ["mono"], description: "Supple freshwater line." },
  { id: "lure-popper-9", name: "Surface Popper 9 cm", department: "lures", price: 4200, stock: 12, water: "salt", tags: ["topwater"], description: "Loud popper for mackerel and jacks." },
  { id: "lure-spoon-30", name: "Chrome Spoon 30 g", department: "lures", price: 2800, stock: 25, water: "both", tags: ["casting"], description: "Long-casting spoon." },
  { id: "lure-minnow-11", name: "Diving Minnow 11 cm", department: "lures", price: 5600, stock: 0, water: "salt", tags: ["diving"], description: "Deep-diving minnow." },
  { id: "lure-jig-60", name: "Metal Jig 60 g", department: "lures", price: 3900, stock: 8, water: "salt", tags: ["jigging", "boat"], description: "Fast-sinking jig." },
  { id: "hooks-circle-4", name: "Circle Hooks size 4/0 (25)", department: "hooks", price: 2500, stock: 30, water: "salt", tags: ["circle"], description: "Corrosion-resistant circle hooks." },
  { id: "hooks-j-6", name: "J Hooks size 6 (50)", department: "hooks", price: 1500, stock: 40, water: "fresh", tags: ["j-hook"], description: "Classic freshwater hooks." },
  { id: "bait-shrimp-frozen", name: "Frozen Shrimp Bait 500 g", department: "bait", price: 2000, stock: 14, water: "salt", tags: ["frozen"], description: "Kept frozen; delivered in a cool bag." },
  { id: "bait-worms", name: "Live Worms (tub)", department: "bait", price: 1200, stock: 0, water: "fresh", tags: ["live"], description: "Fresh worms." },
  { id: "apparel-cap", name: "Tide & Tackle Sun Cap", department: "apparel", price: 4500, stock: 18, water: "both", tags: ["sun"], description: "Wide-brim cap." },
];

export const PROMOS: Record<string, { percent: number; minSubtotal: number; departments?: Department[]; description: string }> = {
  TIDE10: { percent: 10, minSubtotal: 20000, description: "10% off orders of 20,000 FCFA or more" },
  LURES15: { percent: 15, minSubtotal: 0, departments: ["lures"], description: "15% off lures" },
};

export type Slot = { id: string; day: string; window: string; fee: number; capacity: number };
export const SLOTS: Slot[] = [
  { id: "fri-am", day: "Friday", window: "08:00-12:00", fee: 1500, capacity: 0 },
  { id: "fri-pm", day: "Friday", window: "14:00-18:00", fee: 1500, capacity: 3 },
  { id: "sat-am", day: "Saturday", window: "08:00-12:00", fee: 2000, capacity: 5 },
  { id: "sat-pm", day: "Saturday", window: "14:00-18:00", fee: 2000, capacity: 2 },
  { id: "pickup", day: "Any day", window: "Shop pickup, Bonanjo 09:00-19:00", fee: 0, capacity: 99 },
];
