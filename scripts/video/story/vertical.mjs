// The 9:16 cut of the story ad (1080x1920, about 38 s), edited from the main cut: the hook, one product beat and the payoff.
// A 405x720 window of the same 1280x720 frames is shown, so the picture is the main cut, not a second story.
export const SEGMENTS = [
  { from: 0, to: 4.5 },      // street at golden hour: the hook
  { from: 8.6, to: 11.4 },   // Mara: "Nobody comes in."
  { from: 22.2, to: 25.2 },  // Jun: "Wait, I can fix that."
  { from: 36.5, to: 40 },    // the app on the phone, the tap
  { from: 44.2, to: 48 },    // the assistant orders; caption 2 at 46 s
  { from: 62, to: 65 },      // Mara: "Another one?"
  { from: 68, to: 70.2 },    // Mara: "Three orders!"
  { from: 76, to: 81 },      // the orders list; caption 3 at 78 s
  { from: 90, to: 96 },      // the busy shop at sunset
  { from: 96, to: 100 },     // end card
];
export const WINDOW_W = 405;
/** Window centre (x in the 1280 frame) per film time. Most shots keep their subject at the centre because the camera already follows it. */
export const CENTRE_RULES = [
  { t0: 22.2, t1: 25.2, x: 440 },  // Jun, on the left of the chat shot
  { t0: 36.5, t1: 40, x: 760 },    // the phone, right of centre
  { t0: 62, t1: 70.2, x: 430 },    // Mara, left of the rush shots
  { t0: 76, t1: 81, x: 900 },      // the phone with the orders list
];
export const centreAt = (t) => (CENTRE_RULES.find((r) => t >= r.t0 && t < r.t1)?.x ?? 640);
export const windowAt = (t) => ({ x: centreAt(t) - WINDOW_W / 2, w: WINDOW_W });
/** Film time for output time `u`, or null past the end. */
export function filmTime(u) {
  let acc = 0;
  for (const s of SEGMENTS) { const d = s.to - s.from; if (u < acc + d) return s.from + (u - acc); acc += d; }
  return null;
}
export const totalLength = () => SEGMENTS.reduce((a, s) => a + s.to - s.from, 0);
/** Output times where the picture cuts: segment joins plus the camera cuts inside segments. */
export function cutTimes(cuts) {
  const out = [0]; let acc = 0;
  for (const s of SEGMENTS) {
    if (acc > 0) out.push(acc);
    for (const c of cuts) if (c > s.from && c < s.to) out.push(+(acc + c - s.from).toFixed(3));
    acc += s.to - s.from;
  }
  return out.sort((a, b) => a - b);
}
