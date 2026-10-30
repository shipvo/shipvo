import { device } from "../index.web";
export const hasHardwareAsync = async () => true;
export const isEnrolledAsync = async () => device.auth.available();
export const supportedAuthenticationTypesAsync = async () => [1];
export const authenticateAsync = async (o: { promptMessage?: string } = {}) => { const r = await device.auth.confirm(o.promptMessage ?? "Confirm"); return r.ok ? { success: true } : { success: false, error: r.reason === "cancelled" ? "user_cancel" : r.reason }; };
