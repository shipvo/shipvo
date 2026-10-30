import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Runtime, type RuntimeState } from "./modules/purenative-runtime";
import { RELEASE } from "./src/release";
import { useContent } from "./src/content/useContent";
import { ShopApp } from "./src/ui/Shop";
import { useTokens, type Tokens } from "./src/ui/theme";
import type { Order } from "./src/domain/shop";

const POLL_MS = 10_000;
type Line = { at: string; text: string };

async function post(state: RuntimeState | null, path: string, body: Record<string, unknown>) {
  if (!state?.baseUrl) return;
  try { await fetch(`${state.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); } catch {}
}
const report = (state: RuntimeState, event: string, extra: Record<string, unknown> = {}) =>
  post(state, "/t", { schema_version: "1.0", app_id: state.appId, release: state.runningRelease, event, device_class: "low",
    android_api: typeof Platform.Version === "number" ? Platform.Version : undefined, ...extra });

export default function App() {
  const [state, setState] = useState<RuntimeState | null>(() => { try { return Runtime.getState(); } catch { return null; } });
  const { content, refresh } = useContent(state?.baseUrl, state?.appId);
  const T = useTokens(content.theme.accent);
  const [cold, setCold] = useState<number | null>(null);
  const [applyMs, setApplyMs] = useState<number | null>(null);
  const [log, setLog] = useState<Line[]>([]);
  const busyRef = useRef(false);
  const add = (text: string) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text }, ...l].slice(0, 30));

  useEffect(() => {
    try {
      const h = Runtime.markHealthy();
      const s = Runtime.getState();
      const isReload = h.kind ? h.kind === "reload" : h.sinceLoadMs >= 0 && h.coldStartMs - h.sinceLoadMs > 2000;
      setState(s); setCold(isReload ? null : h.coldStartMs); setApplyMs(isReload ? h.sinceLoadMs : null);
      const events = Runtime.consumeEvents();
      events.forEach((e) => add(e.replace(":", " release ")));
      report(s, "applied", isReload ? { apply_ms: h.sinceLoadMs } : { cold_start_ms: h.coldStartMs });
      events.filter((e) => e.startsWith("crash_loop_revert")).forEach(() => report(s, "crash_loop_revert"));
      events.filter((e) => e.startsWith("rolled_back")).forEach(() => report(s, "rolled_back"));
      add(isReload ? `Running release ${s.runningRelease} (applied in ${h.sinceLoadMs} ms, no restart)` : `Running release ${s.runningRelease} (cold start ${h.coldStartMs} ms)`);
    } catch { add("Runtime unavailable (simulator)"); }
  }, []);

  const check = async (manual: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const c = await refresh();
      if (c.changed) { add(`Content v${c.version} live (${c.ms} ms)`); if (state) report(state, "content_applied", { apply_ms: c.ms }); }
      let r;
      try { r = await Runtime.checkForUpdate(true); } catch { return; }
      if (r.status === "staged") {
        const kb = ((r.bytes ?? 0) / 1024).toFixed(1);
        add(`Release ${r.release} verified: ${r.via === "patch" ? `patch ${kb} KB` : `full ${kb} KB`} in ${r.downloadMs} ms. Applying…`);
        if (r.patchError) add(`Patch skipped (${r.patchError}); used full download`);
        report(Runtime.getState(), "applied", { bytes_downloaded: r.bytes, apply_ms: r.downloadMs, published_at: r.issuedAt, via: r.via ?? "full" });
      } else if (r.status === "error") add(`Check failed: ${r.error}`);
      else if (manual) add("Up to date");
    } finally { busyRef.current = false; }
  };

  useEffect(() => {
    check(false);
    const id = setInterval(() => { if (AppState.currentState === "active") check(false); }, POLL_MS);
    return () => clearInterval(id);
  }, [state?.baseUrl]);

  const onOrder = (o: Order) => post(state, `/o/${state?.appId ?? "tide"}`, { order: o, content_version: content.version, release: state?.runningRelease ?? 0 });

  return (
    <>
      <StatusBar style={T.surface === "#0A1113" ? "light" : "dark"} />
      <ShopApp T={T} content={content} onOrder={onOrder}
        about={<About T={T} state={state} cold={cold} applyMs={applyMs} log={log} contentVersion={content.version} onCheck={() => check(true)} />} />
    </>
  );
}

function About({ T, state, cold, applyMs, log, contentVersion, onCheck }: { T: Tokens; state: RuntimeState | null; cold: number | null; applyMs: number | null; log: Line[]; contentVersion: number; onCheck: () => void }) {
  const s = styles(T);
  const Row = ({ k, v, good }: { k: string; v: string; good?: boolean }) => (
    <View style={s.row}><Text style={s.muted}>{k}</Text><Text style={[s.value, good === true && { color: T.success }, good === false && { color: T.critical }]}>{v}</Text></View>
  );
  return (
    <View style={{ gap: 14 }}>
      <View style={[s.hero, { backgroundColor: RELEASE.accent }]}>
        <Text style={s.display} accessibilityRole="header">{RELEASE.headline}</Text>
        <Text style={s.heroNote}>{RELEASE.note}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.title}>This build</Text>
        <Row k="Running release" v={String(state?.runningRelease ?? "…")} />
        <Row k="Last good / previous" v={state ? `${state.currentRelease} / ${state.previousRelease}` : "…"} />
        {applyMs != null ? <Row k="Applied in (no restart)" v={`${applyMs} ms`} good={applyMs < 1000} />
          : <Row k="Cold start" v={cold == null ? "…" : `${cold} ms`} good={cold != null && cold < 1000} />}
        <Row k="Content version" v={String(contentVersion)} />
        <Row k="Cohort / band" v={state ? `${state.cohort} / ${state.band}` : "…"} />
        <Row k="Shell" v={state?.shellVersion ?? "…"} />
        {!!state?.blockedRelease && <Row k="Blocked on this phone" v={`release ${state.blockedRelease} and older`} />}
        <Row k="Checks every" v={`${POLL_MS / 1000} s while open`} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Check for update now" onPress={onCheck} style={[s.btn, { backgroundColor: T.accent }]}><Text style={s.btnText}>Check for update now</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Roll back to previous release" onPress={() => { try { Runtime.rollback(); } catch {} }} style={[s.btn, s.btnGhost]}><Text style={[s.btnText, { color: T.critical }]}>Roll back to previous release</Text></Pressable>
      <View style={s.card}>
        <Text style={s.title}>Update log</Text>
        {log.length === 0 ? <Text style={s.muted}>Nothing yet.</Text> : log.map((l, i) => <Text key={i} style={s.logLine}><Text style={s.muted}>{l.at}  </Text>{l.text}</Text>)}
      </View>
    </View>
  );
}

const styles = (T: Tokens) => StyleSheet.create({
  hero: { borderRadius: 16, padding: 22, gap: 8 },
  display: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: "#FFFFFF" },
  heroNote: { fontSize: 14, lineHeight: 20, color: "#FFFFFF", opacity: 0.9 },
  card: { backgroundColor: T.raised, borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: T.border },
  title: { fontSize: 17, fontWeight: "700", color: T.text },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  value: { fontSize: 15, fontWeight: "600", color: T.text },
  muted: { fontSize: 14, color: T.text2 },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: T.border },
  btnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  logLine: { fontSize: 13, lineHeight: 19, color: T.text },
});
