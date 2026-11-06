import { Capacitor, registerPlugin } from "@capacitor/core";
import { ShipvoCapacitor, NativeStore, NativeFiles, bootAndServe, bootAndSwitch } from "@shipvo/capacitor";
import type { ShipvoNativePlugin } from "@shipvo/capacitor";

declare const __SHIPVO_PUBLIC_KEY__: string;
declare const __SHIPVO_BASE_URL__: string;

/** Starts Shipvo when the build has a public key and a control plane URL (set by scripts/copy-assets.mjs from SHIPVO_PUBLIC_KEY and SHIPVO_BASE_URL). */
export async function startShipvo(): Promise<ShipvoCapacitor | undefined> {
  if (!__SHIPVO_PUBLIC_KEY__ || !__SHIPVO_BASE_URL__) return undefined;
  // The native layer exists on Android and iOS. A browser stays on the embedded build.
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return undefined;
  const native = registerPlugin<ShipvoNativePlugin>("Shipvo");
  const shipvo: ShipvoCapacitor = new ShipvoCapacitor({
    appId: "capacitor-sample", shellMajor: 1, shellVersion: "1.0.0", platform,
    publicKey: __SHIPVO_PUBLIC_KEY__, baseUrl: __SHIPVO_BASE_URL__,
    store: new NativeStore(native), files: new NativeFiles(native),
    onReload: async () => { await bootAndSwitch(shipvo, native); },
  });
  const { release } = await bootAndServe(shipvo, native);
  window.__SHIPVO_RELEASE__ = release || undefined;
  // The page rendered; a pending release is healthy now.
  void shipvo.markHealthy();
  return shipvo;
}
