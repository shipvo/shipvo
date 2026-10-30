// The device API every PureNative app talks to. Same shape on phones and in the simulator.
export type PermissionStatus = "granted" | "denied" | "undetermined";
export type Coords = { latitude: number; longitude: number; accuracy?: number };
export type ScanResult = { type: string; data: string };
export type AuthResult = { ok: true } | { ok: false; reason: "cancelled" | "failed" | "unavailable" | "not_enrolled" };
export type PaymentRequest = { provider: "mobile_money" | "card"; amount: number; currency: string; to: string; reference: string; phone?: string };
export type PaymentResult = { ok: true; receipt: string } | { ok: false; reason: "declined" | "cancelled" | "timeout" | "insufficient_funds" };
export type Notification = { id: string; title: string; body: string; data?: Record<string, unknown> };

export interface Device {
  /** Where this API is running. */
  kind: "native" | "simulated";
  permissions: { get(name: "camera" | "location" | "notifications"): Promise<PermissionStatus>; request(name: "camera" | "location" | "notifications"): Promise<PermissionStatus> };
  location: { current(): Promise<Coords> };
  /** Opens the camera to scan one barcode or QR code. Resolves with the code, or null if the person cancels. */
  camera: { scan(opts?: { prompt?: string }): Promise<ScanResult | null> };
  auth: { available(): Promise<boolean>; confirm(reason: string): Promise<AuthResult> };
  /** Charges through the configured provider. The prompt UI (amount, PIN) is the app's own sheet, identical on every platform. */
  pay: { charge(req: PaymentRequest, pin: string): Promise<PaymentResult> };
  notifications: { show(n: Omit<Notification, "id">): Promise<string>; onOpen(cb: (n: Notification) => void): () => void };
  share: { text(text: string, title?: string): Promise<boolean> };
  clipboard: { set(text: string): Promise<void>; get(): Promise<string> };
  net: { online(): boolean; onChange(cb: (online: boolean) => void): () => void };
}
