// <ScanHost/>: mount once at the app root and `device.camera.scan()` works on phones. It renders a full-screen
// scanner (camera + manual entry) whenever a scan is pending and resolves the promise with the code or null.
// In the simulator the simulated device shows its own scanner sheet, so the web build of this is empty.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { scanBridge } from "./index";

export function ScanHost({ accent = "#1F4E5F" }: { accent?: string }) {
  const [, tick] = useState(0);
  useEffect(() => scanBridge.subscribe(() => tick((n) => n + 1)), []);
  const prompt = scanBridge.current();
  if (prompt === null) return null;
  return <Scanner accent={accent} prompt={prompt || "Point the camera at the code."} onCode={(data, type) => scanBridge.finish({ type, data })} onCancel={() => scanBridge.finish(null)} />;
}

function Scanner({ accent, prompt, onCode, onCancel }: { accent: string; prompt: string; onCode: (data: string, type: string) => void; onCancel: () => void }) {
  const [perm, request] = useCameraPermissions();
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => { if (perm && !perm.granted && (perm as any).canAskAgain !== false) request(); }, [perm?.granted]);
  return (
    <View style={s.page} accessibilityViewIsModal {...({ "aria-modal": true } as any)} accessibilityLabel="Scan a code">
      <Text style={s.h1} accessibilityRole="header">Scan a code</Text>
      <Text style={s.body}>{prompt}</Text>
      {perm?.granted ? (
        <CameraView style={s.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "qr", "code128"] }}
          onBarcodeScanned={(r) => { if (done) return; setDone(true); onCode(r.data, r.type); }} />
      ) : (
        <View style={[s.camera, { alignItems: "center", justifyContent: "center" }]} accessibilityLabel="Camera unavailable">
          <Text style={[s.body, { color: "#fff", textAlign: "center" }]}>{perm && !perm.granted ? "Camera permission is needed to scan." : "Starting camera…"}</Text>
          {perm && !perm.granted && <Pressable accessibilityRole="button" accessibilityLabel="Allow camera" onPress={() => request()} style={[s.btn, { backgroundColor: accent, marginTop: 12 }]}><Text style={s.btnText}>Allow camera</Text></Pressable>}
        </View>
      )}
      <Text style={s.caption}>Can't scan? Type the number under the code.</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={typed} onChangeText={(v) => setTyped(v.replace(/\s/g, "").slice(0, 32))} placeholder="Code" placeholderTextColor="#777" style={s.input} accessibilityLabel="Code" />
        <Pressable accessibilityRole="button" accessibilityLabel="Use typed code" accessibilityState={{ disabled: typed.length < 4 }} disabled={typed.length < 4} onPress={() => { if (!done) { setDone(true); onCode(typed, "manual"); } }}
          style={[s.btn, { backgroundColor: accent }, typed.length < 4 && { opacity: 0.6 }]}><Text style={s.btnText}>Use</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel scan" onPress={onCancel} style={[s.btn, s.ghost]}><Text style={[s.btnText, { color: "#111" }]}>Cancel</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  page: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#F6F8F7", padding: 16, paddingTop: 56, gap: 14 },
  h1: { fontSize: 24, fontWeight: "800", color: "#111" }, body: { fontSize: 15, lineHeight: 21, color: "#111" }, caption: { fontSize: 13, color: "#5B6B66" },
  camera: { height: 280, borderRadius: 16, overflow: "hidden", backgroundColor: "#1a1a1a" },
  input: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: "#CBD5D1", paddingHorizontal: 14, color: "#111", backgroundColor: "#fff", fontSize: 16 },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  ghost: { borderWidth: 1, borderColor: "#CBD5D1", backgroundColor: "transparent" },
  btnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
