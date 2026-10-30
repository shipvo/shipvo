import { device } from "../index.web";
const st = async (s: string) => ({ status: s, granted: s === "granted" });
export const getPermissionsAsync = async () => st(await device.permissions.get("notifications"));
export const requestPermissionsAsync = async () => st(await device.permissions.request("notifications"));
export const scheduleNotificationAsync = async (r: { content: { title?: string; body?: string; data?: any } }) => device.notifications.show({ title: r.content.title ?? "", body: r.content.body ?? "", data: r.content.data });
export const addNotificationResponseReceivedListener = (cb: (r: any) => void) => { const off = device.notifications.onOpen((n) => cb({ notification: { request: { identifier: n.id, content: { title: n.title, body: n.body, data: n.data } } } })); return { remove: off }; };
export const setNotificationHandler = () => {};
