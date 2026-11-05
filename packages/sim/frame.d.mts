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
export type FrameOptions = { skin?: FrameSkin; dark?: boolean; status?: FrameStatus; /** HTML for the screen area. */ screen?: string };
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
