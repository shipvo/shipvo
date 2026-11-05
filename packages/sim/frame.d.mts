export const SKINS: Record<"android" | "iphone", { width: number; height: number; label: string }>;
export const FRAME_CSS: string;
export function frameMarkup(opts?: { skin?: "android" | "iphone"; title?: string; src?: string }): string;
export function frameScript(): string;
export function statusModel(state: unknown, now: Date, bg: string, notifications: number): { time: string; icons: string[]; battery: { level: number; charging: boolean }; notifications: number; textColor: string; background: string };
export function phoneStep(s: { mode: string; menu: boolean }, ev: string): { mode: string; menu: boolean; reload: boolean; event: string | null };
export function batteryIcon(b: { level: number; charging: boolean }): string;
export function appInteractive(s: { mode: string; menu: boolean }): boolean;
