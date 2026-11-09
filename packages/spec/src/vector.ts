/** The `vector` block: shapes with attributes bound to expressions, drawn as SVG. */

export const VECTOR_SHAPES = ["rect", "circle", "path", "text", "linearGradient"] as const;
export const ENTER_MOTIONS = ["fade", "slide", "scale"] as const;
export const CHANGE_MOTIONS = ["countUp", "pulse"] as const;

type Obj = Record<string, any>;
export type Shape = Record<string, unknown> & { shape: string };

const NUMERIC: Record<string, string[]> = {
  rect: ["x", "y", "width", "height", "rx", "strokeWidth", "opacity"],
  circle: ["cx", "cy", "r", "strokeWidth", "opacity"],
  path: ["strokeWidth", "opacity"],
  text: ["x", "y", "fontSize", "opacity"],
  linearGradient: ["x1", "y1", "x2", "y2"]
};
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|url\(#[A-Za-z0-9_-]{1,40}\))$/i;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]{0,2000}$/;
const color = (v: unknown) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : "none");
const esc = (t: unknown) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);

/** Evaluates every attribute of every shape with `ev` and keeps only safe values. */
export function resolveShapes(shapes: unknown, ev: (v: unknown) => unknown): Shape[] {
  const out: Shape[] = [];
  for (const raw of Array.isArray(shapes) ? shapes : []) {
    const s = raw as Obj;
    const kind = String(s?.shape);
    if (!VECTOR_SHAPES.includes(kind as never)) continue;
    const r: Shape = { shape: kind };
    for (const k of NUMERIC[kind]!) if (s[k] !== undefined) r[k] = num(ev(s[k]));
    for (const k of ["fill", "stroke"]) if (s[k] !== undefined && kind !== "linearGradient") r[k] = color(ev(s[k]));
    if (kind === "path") { const d = String(ev(s.d) ?? ""); r.d = PATH.test(d) ? d : ""; }
    if (kind === "text") { r.text = String(ev(s.text) ?? ""); if (s.anchor !== undefined) r.anchor = ["start", "middle", "end"].includes(ev(s.anchor) as string) ? ev(s.anchor) : "start"; }
    if (kind === "linearGradient") {
      r.id = String(s.id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
      r.stops = (Array.isArray(s.stops) ? s.stops : []).map((st: Obj) => ({ offset: Math.min(1, Math.max(0, num(ev(st?.offset)))), color: color(ev(st?.color)) }));
    }
    out.push(r);
  }
  return out;
}

export function vectorSvg(width: number, height: number, shapes: Shape[], name: string): string {
  const a = (s: Shape, keys: Record<string, string>) =>
    Object.entries(keys).filter(([k]) => s[k] !== undefined).map(([k, attr]) => ` ${attr}="${esc(s[k])}"`).join("");
  const body = shapes.map((s) => {
    switch (s.shape) {
      case "rect": return `<rect${a(s, { x: "x", y: "y", width: "width", height: "height", rx: "rx", fill: "fill", stroke: "stroke", strokeWidth: "stroke-width", opacity: "opacity" })}/>`;
      case "circle": return `<circle${a(s, { cx: "cx", cy: "cy", r: "r", fill: "fill", stroke: "stroke", strokeWidth: "stroke-width", opacity: "opacity" })}/>`;
      case "path": return `<path${a(s, { d: "d", fill: "fill", stroke: "stroke", strokeWidth: "stroke-width", opacity: "opacity" })}/>`;
      case "text": return `<text${a(s, { x: "x", y: "y", fontSize: "font-size", fill: "fill", anchor: "text-anchor", opacity: "opacity" })}>${esc(s.text)}</text>`;
      default: {
        const stops = (s.stops as { offset: number; color: string }[]).map((t) => `<stop offset="${t.offset}" stop-color="${esc(t.color)}"/>`).join("");
        return `<defs><linearGradient id="${esc(s.id)}"${a(s, { x1: "x1", y1: "y1", x2: "x2", y2: "y2" })}>${stops}</linearGradient></defs>`;
      }
    }
  }).join("");
  return `<svg role="img" aria-label="${esc(name)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
