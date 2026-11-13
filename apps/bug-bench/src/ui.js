import { Pressable, StyleSheet, Text } from "react-native";

export const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, paddingTop: 48, gap: 12, backgroundColor: "#fff" },
  input: { borderWidth: 1, borderColor: "#888", borderRadius: 8, padding: 10, fontSize: 16 },
  btn: { backgroundColor: "#1F4E5F", borderRadius: 8, padding: 12, alignItems: "center" },
  btnOff: { backgroundColor: "#9aa" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  h: { fontSize: 22, fontWeight: "700" },
});

export const H = ({ children }) => <Text accessibilityRole="header" style={styles.h}>{children}</Text>;

export const Btn = ({ label, onPress, disabled = false }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.btn, disabled && styles.btnOff]}>
    <Text style={styles.btnText}>{label}</Text>
  </Pressable>
);
