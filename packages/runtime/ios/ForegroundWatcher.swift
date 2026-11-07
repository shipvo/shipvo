import Foundation

/// Settles a deferred bundle load once the app shows a screen. Kept free of UIKit so `swift test` can run it; the
/// Expo handler passes the UIKit notification names.
enum ShipvoForegroundWatcher {
  private static var watching = false
  /// The store the observers settle. Tests point it at a test store.
  static var makeStore: () -> Store = { Store() }

  /// Observes every name in `names` (once per process). Each fires the same idempotent settle, so one load never
  /// counts twice.
  static func watch(_ names: [Notification.Name]) {
    Store.lock.lock(); let already = watching; watching = true; Store.lock.unlock()
    if already { return }
    let settle: (Notification) -> Void = { _ in
      ShipvoBundleSelector.settleDeferred(makeStore(), visible: true, crashed: false)
    }
    for n in names { NotificationCenter.default.addObserver(forName: n, object: nil, queue: .main, using: settle) }
  }

  static func resetForTests() { Store.lock.lock(); watching = false; Store.lock.unlock() }
}
