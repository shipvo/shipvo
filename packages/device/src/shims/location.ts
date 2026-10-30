import { device } from "../index.web";
export const Accuracy = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 };
const st = async (s: string) => ({ status: s, granted: s === "granted", canAskAgain: s === "undetermined" });
export const getForegroundPermissionsAsync = async () => st(await device.permissions.get("location"));
export const requestForegroundPermissionsAsync = async () => st(await device.permissions.request("location"));
export const getCurrentPositionAsync = async () => { const c = await device.location.current(); return { coords: { ...c, altitude: null, heading: null, speed: null, altitudeAccuracy: null }, timestamp: Date.now() }; };
export const getLastKnownPositionAsync = getCurrentPositionAsync;
