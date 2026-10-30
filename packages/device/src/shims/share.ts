import { device } from "../index.web";
export const isAvailableAsync = async () => true;
export const shareAsync = async (url: string, o: { dialogTitle?: string } = {}) => { await device.share.text(url, o.dialogTitle); };
