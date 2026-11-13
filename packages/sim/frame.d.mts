export type FrameSkin = "android" | "ios";
export type FrameStatus = {
  /** Text shown on the left, for example "9:41". */
  time?: string;
  /** Bars filled, 0 to 4. Default 4. */
  signal?: number;
  /** Default true. */
  wifi?: boolean;
  /** Shows an airplane icon and hides signal and wifi. */
  airplane?: boolean;
  /** Level 0 to 100, or an object. Default 100. */
  battery?: number | { level?: number; charging?: boolean };
};
export type FrameOptions = { skin?: FrameSkin; dark?: boolean; status?: FrameStatus; /** HTML for the screen area. */ screen?: string; /** Draw Lumi beside the cutout. Default: on, off in CI; SHIPVO_LUMI=off|on overrides. */ lumi?: boolean; /** Also draw Lumi's first-run guide. Needs lumi. Default: off. */ guide?: boolean };
export type Frame = {
  skin: FrameSkin;
  /** Screen size in CSS pixels. */
  width: number;
  height: number;
  /** Size of the whole body, bezel included. */
  outerWidth: number;
  outerHeight: number;
  html: string;
  css: string;
};
export const SKINS: Record<FrameSkin, { label: string; width: number; height: number; radius: number }>;
export function normalizeStatus(status?: FrameStatus): { time: string; signal: number; wifi: boolean; airplane: boolean; battery: { level: number; charging: boolean } };
export function renderFrame(options?: FrameOptions): Frame;
export type DeviceStatusInput = { online?: boolean; airplane?: boolean; battery?: number | { level?: number; charging?: boolean } };
/** Maps the simulated device state and a clock to a status object. */
export function statusFromDevice(device?: DeviceStatusInput, now?: Date): FrameStatus;
/** True when a CSS colour is dark, so the status text should be light. */
export function isDarkBackground(color: string): boolean;
/** The clock text and icons markup, for redrawing the status bar. */
export function statusParts(status?: FrameStatus, skin?: FrameSkin): { time: string; icons: string };
/** Browser script that keeps the status bar live from the app's `pn:status` events. */
export function statusClientScript(iframeId?: string, skin?: FrameSkin, phone?: object): string;

export type LumiState = "idle" | "working" | "happy" | "worried";
export type LumiEvent = { kind: "check-passed" | "flow-done" | "page-error" | "crash" | "action-failed" | "check-failed"; name?: string; error?: unknown; detail?: unknown };
