import { device } from "../index.web";
// Minimal expo-document-picker surface: one file, picked in the simulator's dialog.
export const getDocumentAsync = async (o: { type?: string | string[] } = {}) => {
  const f = await device.files.pick({ type: o.type });
  return f ? { canceled: false, assets: [{ name: f.name, mimeType: f.mimeType, size: f.size, uri: f.uri }] } : { canceled: true, assets: null };
};
