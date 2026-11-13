// Real phone models a session can be: each has the phone's own screen size in CSS pixels, pixel ratio and user agent.
// The app gets the screen without the status bar and the bottom bar, as an app does on that phone.
import { SKINS } from "./frame.mjs";

export const MODELS = [
  { name: "Pixel 7", platform: "android", width: 412, height: 915, scale: 2.625, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Pixel 8", platform: "android", width: 412, height: 915, scale: 2.625, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Pixel 8 Pro", platform: "android", width: 448, height: 997, scale: 3, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Pixel 9", platform: "android", width: 360, height: 808, scale: 3, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Pixel 9 Pro", platform: "android", width: 427, height: 952, scale: 3, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Pixel 9 Pro XL", platform: "android", width: 448, height: 997, scale: 3, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Galaxy S24", platform: "android", width: 360, height: 780, scale: 3, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "Galaxy A55", platform: "android", width: 480, height: 1040, scale: 2.25, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.12 Mobile Safari/537.36" },
  { name: "iPhone 15", platform: "ios", width: 393, height: 852, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 15 Pro Max", platform: "ios", width: 430, height: 932, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 16", platform: "ios", width: 393, height: 852, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 16 Pro", platform: "ios", width: 402, height: 874, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 16 Pro Max", platform: "ios", width: 440, height: 956, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 17", platform: "ios", width: 402, height: 874, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
  { name: "iPhone 17 Pro Max", platform: "ios", width: 440, height: 956, scale: 3, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1" },
];

/** The model a session gets when it is started for a platform without naming one. */
export const DEFAULT_MODEL = { android: "Pixel 8", ios: "iPhone 16" };

/** Finds a model by name. Letter case and extra spaces do not matter. Returns null for an unknown name. */
export function findModel(name) {
  const key = String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return MODELS.find((m) => m.name.toLowerCase() === key) ?? null;
}

/** What a browser context needs to be this phone: the app area as the viewport, the pixel ratio, the user agent and the screen. */
export function modelContext(model) {
  const k = SKINS[model.platform];
  return {
    viewport: { width: model.width, height: model.height - k.status - k.bar },
    screen: { width: model.width, height: model.height },
    deviceScaleFactor: model.scale,
    userAgent: model.userAgent,
  };
}
