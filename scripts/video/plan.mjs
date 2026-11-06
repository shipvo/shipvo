// Turns a video script + the narration manifest into a timeline: scene windows, audio slices, caption cues.
export const LEAD = 0.5, TRAIL = 1.1, TAIL = 3.5;

export function sentences(text) { return text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean); }

export function buildPlan(script, man) {
  let t = 0;
  const scenes = script.scenes.map((s, i) => {
    const seg = man.segments[i];
    if (!seg) throw new Error(`no narration segment for scene ${s.id}`);
    const len = Math.max(s.min ?? 0, LEAD + seg.duration + TRAIL) + (i === script.scenes.length - 1 ? TAIL : 0);
    const out = { ...s, start: t, end: t + len, audio: { start: seg.start, end: seg.end }, dur: seg.duration };
    t += len; return out;
  });
  const cues = [];
  for (const s of scenes) {
    const spoken = sentences(s.narration);
    let shown = s.caption ? sentences(s.caption) : spoken;
    if (shown.length !== spoken.length) shown = spoken;
    const total = spoken.reduce((a, x) => a + x.length, 0);
    let at = s.start + LEAD;
    spoken.forEach((x, k) => { const d = (x.length / total) * s.dur; cues.push({ start: at, end: at + d, text: shown[k] }); at += d; });
  }
  return { scenes, cues, total: t, lead: LEAD };
}

const ts = (x) => { const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = (x % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`; };
export function vtt(plan) { return "WEBVTT\n\n" + plan.cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n"); }

/** Flash cards from script scene.flashes ([{at, text}], seconds from scene start). Each lasts 1.5 s and never runs past its scene. */
export function flashes(script, plan) {
  return plan.scenes.flatMap((sc, i) => (script.scenes[i].flashes || []).map((x) => ({ start: sc.start + x.at, end: Math.min(sc.end, sc.start + x.at + 1.5), text: x.text })));
}
