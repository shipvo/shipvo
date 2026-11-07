import UIKit

// Scene-based test host. The app has a UIApplicationSceneManifest and no window code in the app delegate, so a load
// starts from the scene delegate, as in React Native 0.88 apps. It links the runtime's own Swift sources (the same files
// the CocoaPods podspec builds, minus the Expo module) and makes the choices ShipvoReactDelegateHandler makes.
// Launch arguments: --case <stage|load|bgload|healthy> --base <url> --key <publicKey> --out <result.json>

enum Host {
  static var args = CommandLine.arguments
  static func arg(_ name: String) -> String? { if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }; return nil }
  static let mode = arg("--case") ?? ""
  static let out = arg("--out") ?? NSTemporaryDirectory() + "result.json"
  static let suite = "shipvo.scenehost"
  static let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("scenehost", isDirectory: true)

  static func makeStore() -> Store {
    let s = Store(overrides: .init(suite: suite, dir: dir, baseUrl: arg("--base") ?? "", publicKey: arg("--key") ?? "", appId: "good",
                                   shellMajor: 1, shellVersion: "1.0.0", binaryVersion: "1.0.0/1"))
    if s.binaryVersion == nil { s.binaryVersion = "1.0.0/1" }
    return s
  }

  static func write(_ s: Store, _ extra: [String: Any] = [:]) {
    var r: [String: Any] = ["case": mode, "trialBoots": s.trialBoots, "pendingRelease": s.pendingRelease, "currentRelease": s.currentRelease,
                            "blockedRelease": s.blockedRelease, "runningRelease": Store.runningRelease, "loads": Store.loadsInProcess,
                            "events": s.consumeEvents()]
    for (k, v) in extra { r[k] = v }
    if let d = try? JSONSerialization.data(withJSONObject: r) { try? d.write(to: URL(fileURLWithPath: out)) }
    FileHandle.standardOutput.write(Data("RESULT \(String(data: (try? JSONSerialization.data(withJSONObject: r)) ?? Data(), encoding: .utf8) ?? "")\n".utf8))
  }

  /// What ShipvoReactDelegateHandler does when React asks for the bundle URL.
  static func startReact(visible: Bool) {
    ShipvoForegroundWatcher.makeStore = { makeStore() }
    ShipvoForegroundWatcher.watch([UIApplication.didBecomeActiveNotification, UIScene.didActivateNotification])
    for _ in 0..<3 { _ = ShipvoBundleSelector.select(makeStore(), visible: visible) } // React asks more than once
  }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    switch Host.mode {
    case "stage":
      UserDefaults(suiteName: Host.suite)?.removePersistentDomain(forName: Host.suite)
      try? FileManager.default.removeItem(at: Host.dir)
      Task {
        let s = Host.makeStore()
        let r = (try? await Updater.check(s)) ?? ["status": "error"]
        Host.write(s, ["status": r["status"] as? String ?? "?"]); exit(0)
      }
    case "bgload":
      // A background start: the process runs before any scene is connected. Nothing may be counted until one activates.
      Host.startReact(visible: false)
      Host.write(Host.makeStore(), ["scene": false]); exit(0)
    default: break
    }
    return true
  }
  func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    UISceneConfiguration(name: "Default", sessionRole: session.role)
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let ws = scene as? UIWindowScene else { return }
    window = UIWindow(windowScene: ws)
    window?.rootViewController = UIViewController()
    window?.makeKeyAndVisible()
    guard Host.mode == "load" || Host.mode == "healthy" else { return }
    Host.startReact(visible: UIApplication.shared.applicationState != .background)
    // Give both activation notifications time to arrive, then report. Two counts for one load would show here.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      let s = Host.makeStore()
      var extra: [String: Any] = ["scene": true]
      if Host.mode == "healthy" {
        extra["promoted"] = ShipvoBundleSelector.promoteIfRunning(s)
        ShipvoBundleSelector.noteHealthy()
      }
      Host.write(s, extra); exit(0)
    }
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
