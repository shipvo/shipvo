import { afterEach, describe, expect, it, vi } from "vitest";
import Module from "node:module";

vi.mock("react-native", () => ({ Platform: { OS: "android" }, Share: {}, Linking: {} }));
const M = Module as any; const realLoad = M._load;
async function load(mod: any) {
  vi.resetModules();
  M._load = function (req: string, ...rest: any[]) {
    if (req !== "expo-document-picker") return realLoad.call(this, req, ...rest);
    if (!mod) throw new Error("Cannot find module 'expo-document-picker'");
    return mod;
  };
  return (await import("../../device/src/index")).device;
}
afterEach(() => { M._load = realLoad; });

describe("native files", () => {
  it("reports real when expo-document-picker resolves", async () => { expect((await load({})).capabilities().files).toBe("real"); });
  it("reports unavailable when it does not", async () => { expect((await load(null)).capabilities().files).toBe("unavailable"); });
  it("throws when not installed", async () => { await expect((await load(null)).files.pick()).rejects.toThrow("expo-document-picker is not installed"); });
  it("returns the picked file's metadata and passes the type filter", async () => {
    const getDocumentAsync = vi.fn(async () => ({ canceled: false, assets: [{ name: "a.pdf", mimeType: "application/pdf", size: 12, uri: "file:///a.pdf" }] }));
    expect(await (await load({ getDocumentAsync })).files.pick({ type: "application/pdf" })).toEqual({ name: "a.pdf", mimeType: "application/pdf", size: 12, uri: "file:///a.pdf" });
    expect(getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: "application/pdf", multiple: false }));
  });
  it("returns null when cancelled", async () => {
    expect(await (await load({ getDocumentAsync: async () => ({ canceled: true, assets: null }) })).files.pick()).toBeNull();
  });
});
