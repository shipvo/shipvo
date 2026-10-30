// Native-feature UI shared by phones and the simulator: scanner, payment prompt, location helper.
// Everything here goes through @shipvo/device, so the simulator can stand in for the phone.
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { device, type PaymentRequest, type PaymentResult } from "@shipvo/device";
import type { Tokens } from "./theme";
import { fcfa } from "./theme";

/** Camera scanner. Calls onCode once with the first barcode seen. */
export function ScanScreen({ T, onCode, onCancel, prompt }: { T: Tokens; onCode: (code: string) => void; onCancel: () => void; prompt: string }) {
  const [perm, request] = useCameraPermissions();
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => { if (perm && !perm.granted && (perm as any).canAskAgain !== false) request(); }, [perm?.granted]);
  const s = st(T);
  return (
    <View style={s.page} accessibilityLabel="Scan a product">
      <Text style={s.h1} accessibilityRole="header">Scan a product</Text>
      <Text style={s.body}>{prompt}</Text>
      {perm?.granted ? (
        <CameraView style={s.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "qr", "code128"] }}
          onBarcodeScanned={(r) => { if (done) return; setDone(true); onCode(r.data); }} />
      ) : (
        <View style={[s.camera, { alignItems: "center", justifyContent: "center" }]} accessibilityLabel="Camera unavailable">
          <Text style={[s.body, { color: "#fff", textAlign: "center" }]}>{perm && !perm.granted ? `Camera permission is needed to scan. (${perm.status}${(perm as any).canAskAgain === false ? ", ask again: no" : ""})` : "Starting camera…"}</Text>
          {perm && !perm.granted && <Pressable accessibilityRole="button" accessibilityLabel="Allow camera" onPress={() => request()} style={[s.btn, { backgroundColor: T.accent, marginTop: 12 }]}><Text style={s.btnText}>Allow camera</Text></Pressable>}
        </View>
      )}
      {/* Poor light, a scratched pack, a weak camera: the code can always be typed. */}
      <Text style={s.caption}>Can't scan? Type the number under the barcode.</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={typed} onChangeText={(v) => setTyped(v.replace(/\D/g, "").slice(0, 14))} keyboardType="number-pad" placeholder="e.g. 6181234567890" placeholderTextColor={T.text2}
          style={[s.input, { flex: 1, letterSpacing: 0, fontSize: 16 }]} accessibilityLabel="Barcode number" testID="barcode-input" />
        <Pressable accessibilityRole="button" accessibilityLabel="Find product by barcode" accessibilityState={{ disabled: typed.length < 8 }} disabled={typed.length < 8} onPress={() => { if (!done) { setDone(true); onCode(typed); } }}
          style={[s.btn, { backgroundColor: T.accent }, typed.length < 8 && { opacity: 0.6 }]}><Text style={s.btnText}>Find</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel scan" onPress={onCancel} style={[s.btn, s.ghost]}><Text style={[s.btnText, { color: T.text }]}>Cancel</Text></Pressable>
    </View>
  );
}

/** The payment prompt: amount, payee, PIN. Same screen on phones and in the simulator; the provider decides the outcome. */
export function PaymentSheet({ T, req, onDone, onCancel }: { T: Tokens; req: PaymentRequest; onDone: (r: PaymentResult) => void; onCancel: () => void }) {
  const [pin, setPin] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const s = st(T);
  const confirm = async () => {
    if (pin.length < 4) return setErr("Enter your 4-digit PIN.");
    setBusy(true); setErr(null);
    const r = await device.pay.charge(req, pin); setBusy(false);
    if (r.ok) return onDone(r);
    setErr(r.reason === "declined" ? "Payment declined. Check your PIN and try again." : r.reason === "insufficient_funds" ? "Insufficient funds." : r.reason === "timeout" ? "The provider did not answer. Try again." : "Payment cancelled.");
  };
  return (
    <View style={s.overlay} collapsable={false} accessibilityViewIsModal {...({ "aria-modal": true } as any)} accessibilityLabel="Mobile money payment">
      {/* The number pad must never cover Confirm: the sheet rises above the keyboard. */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.sheet}>
        <Text style={s.h2} accessibilityRole="header">Mobile money payment</Text>
        <Text style={s.body}>Pay {fcfa(req.amount)} to {req.to}</Text>
        <Text style={s.caption}>Reference {req.reference}{req.phone ? ` · ${req.phone}` : ""}</Text>
        <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))} secureTextEntry keyboardType="number-pad" placeholder="PIN" placeholderTextColor={T.text2}
          style={s.input} accessibilityLabel="Mobile money PIN" testID="pin-input" />
        {err && <Text style={[s.body, { color: T.critical }]} accessibilityLiveRegion="assertive">{err}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Confirm payment" accessibilityState={{ disabled: busy }} disabled={busy} onPress={confirm} style={[s.btn, { backgroundColor: T.accent }, busy && { opacity: 0.6 }]}>
          <Text style={s.btnText}>{busy ? "Confirming…" : "Confirm payment"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel payment" onPress={onCancel} style={[s.btn, s.ghost]}><Text style={[s.btnText, { color: T.text }]}>Cancel</Text></Pressable>
      </KeyboardAvoidingView>
    </View>
  );
}

const SHOP = { latitude: 4.0170, longitude: 9.6935 }; // Bonanjo, Douala
export function kmBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371, dLat = ((b.latitude - a.latitude) * Math.PI) / 180, dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/** Where the customer is, as an address line and the distance to the shop. */
export async function locateCustomer(): Promise<{ address: string; kmToShop: number } | { error: string }> {
  try {
    const c = await device.location.current();
    const km = kmBetween(c, SHOP);
    const area = km < 1.2 ? "Bonanjo" : km < 3 ? "Bonapriso" : km < 6 ? "Akwa" : "Douala";
    return { address: `${area}, Douala (${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)})`, kmToShop: Math.round(km * 10) / 10 };
  } catch (e: any) { return { error: /denied/i.test(String(e?.message)) ? "Location permission was not granted." : "Could not get your location." }; }
}

const st = (T: Tokens) => StyleSheet.create({
  page: { padding: 16, gap: 14, flex: 1 },
  h1: { fontSize: 24, fontWeight: "800", color: T.text }, h2: { fontSize: 17, fontWeight: "700", color: T.text },
  body: { fontSize: 15, lineHeight: 21, color: T.text }, caption: { fontSize: 13, color: T.text2 },
  camera: { height: 280, borderRadius: 16, overflow: "hidden", backgroundColor: "#1a1a1a" },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  ghost: { borderWidth: 1, borderColor: T.border, backgroundColor: "transparent" },
  btnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: T.border, paddingHorizontal: 14, color: T.text, backgroundColor: T.raised, fontSize: 18, letterSpacing: 6 },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: T.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 12 },
});
