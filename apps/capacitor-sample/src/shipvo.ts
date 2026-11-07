import { Capacitor, registerPlugin } from "@capacitor/core";
import { ShipvoCapacitor, NativeStore, NativeFiles, bootAndServe, bootAndSwitch } from "@shipvo/capacitor";
import type { ShipvoNativePlugin } from "@shipvo/capacitor";
import { announceVersion, versionLabel } from "./launch.js";

declare const __SHIPVO_PUBLIC_KEY__: string;
declare const __SHIPVO_BASE_URL__: string;
declare const __SHIPVO_SIM_CHECK__: boolean;

/** Starts Shipvo when the build has a public key and a control plane URL (set by scripts/copy-assets.mjs from SHIPVO_PUBLIC_KEY and SHIPVO_BASE_URL). */
export async function startShipvo(): Promise<ShipvoCapacitor | undefined> {
  if (!__SHIPVO_PUBLIC_KEY__ || !__SHIPVO_BASE_URL__) return undefined;
  // The native layer exists on Android and iOS. Other shells stay on the embedded build.
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return undefined;
  const native = registerPlugin<ShipvoNativePlugin>("Shipvo");
  const shipvo: ShipvoCapacitor = new ShipvoCapacitor({
    appId: "capacitor-sample", shellMajor: 1, shellVersion: "1.0.0", platform,
    publicKey: __SHIPVO_PUBLIC_KEY__, baseUrl: __SHIPVO_BASE_URL__,
    store: new NativeStore(native), files: new NativeFiles(native),
    onReload: async () => { await bootAndSwitch(shipvo, native); },
  });
  const { serving } = await native.status();
  const boot = await bootAndServe(shipvo, native);
  window.__SHIPVO_RELEASE__ = boot.release || undefined;
  // A switch to a staged bundle reloads the page. The reloaded page shows the version and marks itself healthy.
  if (boot.served && !serving) return shipvo;
  // Launch hook: show which bundle this page came from. The simulator script sets __SHIPVO_SIM_CHECK__ to read it.
  await announceVersion(versionLabel(serving), __SHIPVO_SIM_CHECK__ ? __SHIPVO_BASE_URL__ : undefined);
  // The page rendered; a pending release is healthy now.
  void shipvo.markHealthy();
  if (__SHIPVO_SIM_CHECK__) await shipvo.checkForUpdate({ apply: true });
  return shipvo;
}
