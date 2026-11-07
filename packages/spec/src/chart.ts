/** Chart data and SVG for the `chart` block. Colours come from theme tokens only. */

export type ChartKind = "line" | "area" | "bar" | "donut";
export type Aggregate = "sum" | "avg" | "count" | "min" | "max";
export const CHART_KINDS: readonly string[] = ["line", "area", "bar", "donut"];
export const AGGREGATES: readonly string[] = ["sum", "avg", "count", "min", "max"];

export interface ChartPoint { x: string; y: number; series: string }

/** Groups points by series and x (first-seen order) and combines the y values. */
export function aggregatePoints(points: ChartPoint[], how: Aggregate): ChartPoint[] {
  const groups = new Map<string, { x: string; series: string; ys: number[] }>();
  for (const p of points) {
    const key = JSON.stringify([p.series, p.x]);
    const g = groups.get(key) ?? { x: p.x, series: p.series, ys: [] };
    g.ys.push(p.y);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const sum = g.ys.reduce((a, b) => a + b, 0);
    const y = how === "sum" ? sum : how === "avg" ? sum / g.ys.length : how === "count" ? g.ys.length
      : how === "min" ? Math.min(...g.ys) : Math.max(...g.ys);
    return { x: g.x, series: g.series, y };
  });
}

export const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** "Revenue by day: Mon 120, Tue 90". With several series each point is "Series Mon 120". */
export function chartText(label: string, points: ChartPoint[]): string {
  const multi = new Set(points.map((p) => p.series)).size > 1;
  const body = points.map((p) => `${multi && p.series ? `${p.series} ` : ""}${p.x} ${fmt(p.y)}`).join(", ");
  return body ? `${label}: ${body}` : `${label}: no data`;
}

export interface ChartColors { primary: string; accent: string; success: string; danger: string; muted: string; surface: string; text: string }

const W = 320, H = 180, L = 36, R = 8, T = 10, B = 28;

export function chartSvg(kind: ChartKind, points: ChartPoint[], c: ChartColors, name: string, esc: (t: unknown) => string, font: string): string {
  const cycle = [c.primary, c.accent, c.success, c.danger, c.muted];
  const open = `<svg role="img" aria-label="${esc(name)}" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block" data-chart="${kind}">`;
  if (!points.length) return `${open}<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${c.muted}" font-size="13" font-family="${font}">No data</text></svg>`;
  if (kind === "donut") {
    const total = points.reduce((a, p) => a + Math.max(0, p.y), 0) || 1;
    const cx = 90, cy = 90, r = 70, sw = 28, circ = 2 * Math.PI * (r - sw / 2);
    let offset = 0;
    const arcs = points.map((p, i) => {
      const len = (Math.max(0, p.y) / total) * circ;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r - sw / 2}" fill="none" stroke="${cycle[i % cycle.length]}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
      return el;
    }).join("");
    const legend = points.slice(0, 8).map((p, i) =>
      `<rect x="180" y="${20 + i * 18}" width="10" height="10" fill="${cycle[i % cycle.length]}"/><text x="196" y="${29 + i * 18}" fill="${c.text}" font-size="12" font-family="${font}">${esc(p.x)} ${fmt(p.y)}</text>`).join("");
    return `${open}${arcs}${legend}</svg>`;
  }
  const xs = [...new Set(points.map((p) => p.x))];
  const series = [...new Set(points.map((p) => p.series))];
  const max = Math.max(0, ...points.map((p) => p.y)), min = Math.min(0, ...points.map((p) => p.y));
  const span = max - min || 1;
  const pw = W - L - R, ph = H - T - B;
  const yOf = (v: number) => T + ph - ((v - min) / span) * ph;
  const step = pw / xs.length;
  const xOf = (x: string) => L + step * xs.indexOf(x) + step / 2;
  let out = `<line x1="${L}" y1="${yOf(0)}" x2="${W - R}" y2="${yOf(0)}" stroke="${c.muted}" stroke-width="1"/>`;
  out += `<text x="${L - 4}" y="${T + 8}" text-anchor="end" fill="${c.muted}" font-size="10" font-family="${font}">${esc(fmt(max))}</text>`;
  const every = Math.ceil(xs.length / 6);
  xs.forEach((x, i) => {
    if (i % every === 0) out += `<text x="${xOf(x).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${c.muted}" font-size="10" font-family="${font}">${esc(x)}</text>`;
  });
  series.forEach((s, si) => {
    const color = cycle[si % cycle.length];
    const pts = points.filter((p) => p.series === s);
    if (kind === "bar") {
      const bw = Math.max(2, (step * 0.7) / series.length);
      for (const p of pts) {
        const x0 = xOf(p.x) - (step * 0.7) / 2 + si * bw;
        const y1 = yOf(Math.max(p.y, 0)), y2 = yOf(Math.min(p.y, 0));
        out += `<rect x="${x0.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y2 - y1).toFixed(1)}" fill="${color}"/>`;
      }
      return;
    }
    const coords = pts.map((p) => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`);
    if (kind === "area" && pts.length) {
      const first = xOf(pts[0]!.x).toFixed(1), last = xOf(pts[pts.length - 1]!.x).toFixed(1);
      out += `<polygon points="${first},${yOf(0)} ${coords.join(" ")} ${last},${yOf(0)}" fill="${color}" fill-opacity="0.25"/>`;
    }
    out += `<polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    for (const p of pts) out += `<circle cx="${xOf(p.x).toFixed(1)}" cy="${yOf(p.y).toFixed(1)}" r="3" fill="${color}"/>`;
  });
  return `${open}${out}</svg>`;
}
