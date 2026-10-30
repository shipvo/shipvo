// Minimal expo-camera surface for the simulator: permissions, and a CameraView that reports the barcode the
// simulated camera is looking at (set by the simulator), after a short delay like a real scanner.
import React, { useEffect } from "react";
import { View } from "react-native";
import { device, simState } from "../index.web";
const st = async (s: string) => ({ status: s, granted: s === "granted" });
export const Camera = { getCameraPermissionsAsync: async () => st(await device.permissions.get("camera")), requestCameraPermissionsAsync: async () => st(await device.permissions.request("camera")) };
export const useCameraPermissions = () => {
  const [p, setP] = React.useState<any>(null);
  useEffect(() => { Camera.getCameraPermissionsAsync().then(setP); }, []);
  return [p, async () => { const r = await Camera.requestCameraPermissionsAsync(); setP(r); return r; }] as const;
};
export function CameraView(props: { onBarcodeScanned?: (r: { type: string; data: string }) => void; style?: any; children?: any; barcodeScannerSettings?: any; facing?: string }) {
  useEffect(() => {
    const code = simState.camera.barcode; if (!code || !props.onBarcodeScanned) return;
    const t = setTimeout(() => props.onBarcodeScanned!({ ...code }), simState.camera.delayMs ?? 800);
    return () => clearTimeout(t);
  }, [simState.camera.barcode?.data]);
  return React.createElement(View, { style: [{ backgroundColor: "#1a1a1a" }, props.style], accessibilityRole: "image", accessibilityLabel: "Camera preview" }, props.children);
}
