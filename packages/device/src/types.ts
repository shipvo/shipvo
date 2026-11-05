// The device API every Shipvo app talks to. Same shape on phones and in the simulator.
export type PermissionStatus = "granted" | "denied" | "undetermined";
export type Coords = { latitude: number; longitude: number; accuracy?: number };
export type ScanResult = { type: string; data: string };
export type AuthResult = { ok: true } | { ok: false; reason: "cancelled" | "failed" | "unavailable" | "not_enrolled" };
export type PaymentRequest = { provider: "mobile_money" | "card"; amount: number; currency: string; to: string; reference: string; phone?: string };
export type PaymentResult = { ok: true; receipt: string } | { ok: false; reason: "declined" | "cancelled" | "timeout" | "insufficient_funds" };
/** One address-book entry. */
export type Contact = { id: string; name: string; phoneNumbers?: string[]; emails?: string[] };
/** One calendar event. `start` and `end` are ISO 8601 strings. */
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay?: boolean; location?: string; notes?: string };
/** A time range for reading events. Events that overlap it are returned. */
export type DateRange = { start: string | Date; end: string | Date };
/** A file the person picked. `uri` can be read with `fetch`. */
export type PickedFile = { name: string; mimeType: string; size: number; uri: string };
/** Options for the file picker. `type` is a MIME filter such as `image/*` or `application/pdf` (or a list of them). Default: any file. */
export type PickFileOptions = { type?: string | string[] };
export type PermissionName = "camera" | "location" | "notifications" | "contacts" | "calendar";
export type Notification = { id: string; title: string; body: string; data?: Record<string, unknown> };

export type Capability = "camera" | "location" | "biometrics" | "payments" | "notifications" | "share" | "clipboard" | "network" | "contacts" | "calendar" | "files";
/** How a capability is provided here: by the real OS/SDK, by the simulated device, or not at all. Never a silent fallback. */
export type MicrophoneSession = { source: "real" | "simulated"; stream?: unknown; level(): number; stop(): void };
export type Support = "real" | "simulated" | "unavailable";
export interface Device {
  /** Where this API is running. */
  kind: "native" | "simulated";
  /** Declared support per capability on this device, so tests and agents know what was actually exercised. */
  capabilities(): Record<Capability, Support>;
  permissions: { get(name: PermissionName): Promise<PermissionStatus>; request(name: PermissionName): Promise<PermissionStatus> };
  location: { current(): Promise<Coords> };
  /** Opens the camera to scan one barcode or QR code. Resolves with the code, or null if the person cancels. */
  camera: { scan(opts?: { prompt?: string }): Promise<ScanResult | null> };
  /** Web and simulator only. Opens the microphone: the real one when a person is present and allows it, else the simulated one. `source` says which. */
  microphone?: { open(): Promise<MicrophoneSession> };
  auth: { available(): Promise<boolean>; confirm(reason: string): Promise<AuthResult> };
  /** Charges through the configured provider. The prompt UI (amount, PIN) is the app's own sheet, identical on every platform. */
  pay: { charge(req: PaymentRequest, pin: string): Promise<PaymentResult> };
  notifications: {
    show(n: Omit<Notification, "id">): Promise<string>;
    /** Same as `onTapped`. Kept for existing code. */
    onOpen(cb: (n: Notification) => void): () => void;
    /** Calls `cb` with each notification that reaches the app. Nothing is delivered unless notification permission is granted. Returns an unsubscribe function. */
    onReceived(cb: (n: Notification) => void): () => void;
    /** Calls `cb` when the person taps a notification, with its `data`. Returns an unsubscribe function. */
    onTapped(cb: (n: Notification) => void): () => void;
  };
  share: { text(text: string, title?: string): Promise<boolean> };
  /** Reads the address book. Asks for permission first; throws `Contacts permission denied` when refused. Read-only. */
  contacts: { getAll(): Promise<Contact[]> };
  /** Reads calendar events that overlap `range`, ordered by start. Asks for permission first; throws `Calendar permission denied` when refused. Read-only. */
  calendar: { getEvents(range: DateRange): Promise<CalendarEvent[]> };
  /** Opens the system file picker for one file. Resolves with the file, or null if the person cancels. */
  files: { pick(options?: PickFileOptions): Promise<PickedFile | null> };
  clipboard: { set(text: string): Promise<void>; get(): Promise<string> };
  net: { online(): boolean; onChange(cb: (online: boolean) => void): () => void };
}
