import ExpoModulesCore
import Foundation

/// Chooses the JS bundle at load. Order: a staged (pending) release on trial, else the last good release, else the
/// bundle embedded in the app (returning nil lets React Native use main.jsbundle). A pending release that does not
/// reach markHealthy within 3 loads is discarded; a current release that loads unhealthy 3 times inside 60 s falls
/// back to the previous one. Same rules as the Android host handler.
public final class ShipvoReactDelegateHandler: ExpoReactDelegateHandler {
  public override func bundleURL(reactDelegate: ExpoReactDelegate) -> URL? {
#if DEBUG
    return nil // development builds load from Metro
#else
    return ShipvoBundleSelector.select(Store())
#endif
  }
}
