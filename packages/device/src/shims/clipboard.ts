import { device } from "../index.web";
export const setStringAsync = (t: string) => device.clipboard.set(t);
export const getStringAsync = () => device.clipboard.get();
