import ExpoModulesCore
import Foundation
import UIKit

/// Chooses the JS bundle at load. Order: a staged (pending) release on trial, else the last good release, else the
/// bundle embedded in the app (returning nil lets React Native use main.jsbundle). A pending release that does not
/// reach markHealthy within 3 loads is discarded; a current release that loads unhealthy 3 times inside 60 s falls
/// back to the previous one. Same rules as the Android host handler.
public final class ShipvoReactDelegateHandler: ExpoReactDelegateHandler {
  public override func bundleURL(reactDelegate: ExpoReactDelegate) -> URL? {
#if DEBUG
    return nil // development builds load from Metro
#else
    Self.watchForeground()
    return ShipvoBundleSelector.select(Store(), visible: Self.appIsVisible())
#endif
  }

  /// False when the app was started in the background (a silent push or background task): the load has no screen yet.
  /// Off the main thread the state cannot be read safely, so the load counts as visible, as it did before.
  private static func appIsVisible() -> Bool {
    guard Thread.isMainThread else { return true }
    return UIApplication.shared.applicationState != .background
  }

  private static var watching = false
  /// The store the observers settle. Tests point it at a test store.
  static var makeStore: () -> Store = { Store() }

  /// Counts a deferred load on the first `didBecomeActive`, or on the first scene activation in apps that use the
  /// UIScene lifecycle. Both paths call the same idempotent settle, so one load never counts twice.
  static func watchForeground() {
    Store.lock.lock(); let already = watching; watching = true; Store.lock.unlock()
    if already { return }
    let settle: (Notification) -> Void = { _ in
      ShipvoBundleSelector.settleDeferred(makeStore(), visible: true, crashed: false)
    }
    NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main, using: settle)
    NotificationCenter.default.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main, using: settle)
  }
}
