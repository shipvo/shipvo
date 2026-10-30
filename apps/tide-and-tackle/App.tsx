import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Runtime, type RuntimeState } from "./modules/purenative-runtime";
import { RELEASE } from "./src/release";

const T = {
  surface: "#F3F8FA", raised: "#FBFEFF", sunken: "#E7EEF1", text: "#181B1C", text2: "#525657",
  border: "#899094", accent: RELEASE.accent, onAccent: "#FFFFFF", soft: "#C5F0FF", secondary: "#D98E04",
  success: "#278733", critical: "#B94642",
};
const POLL_MS = 10_000;

type Line = { at: string; text: string };

async function report(state: RuntimeState, event: string, extra: Record<string, unknown> = {}) {
  try {
    await fetch(`${state.baseUrl}/t`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema_version: "1.0", app_id: state.appId, release: state.runningRelease, event, device_class: "low",
        android_api: typeof Platform.Version === "number" ? Platform.Version : undefined, ...extra }),
    });
  } catch {}
}

export default function App() {
  const [state, setState] = useState<RuntimeState | null>(null);
  const [cold, setCold] = useState<number | null>(null);
  const [log, setLog] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const add = (text: string) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text }, ...l].slice(0, 30));

  useEffect(() => {
    const h = Runtime.markHealthy();
    const s = Runtime.getState();
    setState(s); setCold(h.coldStartMs);
    const events = Runtime.consumeEvents();
    events.forEach((e) => add(e.replace(":", " release ")));
    if (h.promoted) report(s, "applied", { cold_start_ms: h.coldStartMs, apply_ms: h.sinceLoadMs });
    else report(s, "applied", { cold_start_ms: h.coldStartMs });
    events.filter((e) => e.startsWith("crash_loop_revert")).forEach(() => report(s, "crash_loop_revert"));
    events.filter((e) => e.startsWith("rolled_back")).forEach(() => report(s, "rolled_back"));
    add(`Running release ${s.runningRelease} (${h.coldStartMs} ms since process start)`);
  }, []);

  const check = async (manual: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const r = await Runtime.checkForUpdate(true);
      if (r.status === "staged") {
        add(`Release ${r.release} verified: ${Math.round((r.bytes ?? 0) / 1024)} KB in ${r.downloadMs} ms. Applying…`);
        const s = Runtime.getState();
        report(s, "applied", { bytes_downloaded: r.bytes, apply_ms: r.downloadMs, published_at: r.issuedAt });
      } else if (r.status === "error") { add(`Check failed: ${r.error}`); }
      else if (manual) add("Up to date");
    } finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    check(false);
    const id = setInterval(() => { if (AppState.currentState === "active") check(false); }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <ScrollView style={{ backgroundColor: T.surface }} contentContainerStyle={s.page}>
      <StatusBar style="dark" />
      <Text style={s.brand}>Tide & Tackle</Text>
      <View style={[s.hero, { backgroundColor: T.accent }]}>
        <Text style={s.display} accessibilityRole="header">{RELEASE.headline}</Text>
        <Text style={s.heroNote}>{RELEASE.note}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.title}>Spike read-out</Text>
        <Row k="Running release" v={String(state?.runningRelease ?? "…")} />
        <Row k="Last good / previous" v={state ? `${state.currentRelease} / ${state.previousRelease}` : "…"} />
        <Row k="Cold start" v={cold == null ? "…" : `${cold} ms`} good={cold != null && cold < 1000} />
        <Row k="Cohort / band" v={state ? `${state.cohort} / ${state.band}` : "…"} />
        <Row k="Checks every" v={`${POLL_MS / 1000} s while open`} />
      </View>

      <View style={s.actions}>
        <Pressable accessibilityRole="button" onPress={() => check(true)} disabled={busy}
          style={({ pressed }) => [s.btn, { backgroundColor: T.accent, opacity: pressed || busy ? 0.7 : 1 }]}>
          <Text style={s.btnText}>{busy ? "Checking…" : "Check for update now"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => Runtime.rollback()}
          style={({ pressed }) => [s.btn, s.btnGhost, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[s.btnText, { color: T.critical }]}>Roll back to previous release</Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.title}>Update log</Text>
        {log.length === 0 ? <Text style={s.muted}>Nothing yet.</Text> :
          log.map((l, i) => <Text key={i} style={s.logLine}><Text style={s.muted}>{l.at}  </Text>{l.text}</Text>)}
      </View>
    </ScrollView>
  );
}

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.muted}>{k}</Text>
      <Text style={[s.value, good === true && { color: T.success }, good === false && { color: T.critical }]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, gap: 16 },
  brand: { fontSize: 15, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", color: T.text2 },
  hero: { borderRadius: 16, padding: 24, gap: 10 },
  display: { fontSize: 30, lineHeight: 36, fontWeight: "800", color: T.onAccent },
  heroNote: { fontSize: 15, lineHeight: 21, color: T.onAccent, opacity: 0.9 },
  card: { backgroundColor: T.raised, borderRadius: 12, padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: T.border },
  title: { fontSize: 17, fontWeight: "700", color: T.text },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  value: { fontSize: 15, fontWeight: "600", color: T.text },
  muted: { fontSize: 14, color: T.text2 },
  actions: { gap: 10 },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: T.border },
  btnText: { fontSize: 16, fontWeight: "700", color: T.onAccent },
  logLine: { fontSize: 13, lineHeight: 19, color: T.text },
});
