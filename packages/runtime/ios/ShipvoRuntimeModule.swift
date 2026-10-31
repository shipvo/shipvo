import ExpoModulesCore
import Foundation
import React

/// JS-facing runtime: getState / checkForUpdate / markHealthy / consumeEvents / rollback / reload.
/// Same contract as the Android module so `Runtime` in src/index.ts is platform-neutral.
public final class ShipvoRuntimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShipvoRuntime")

    Function("getState") { () -> [String: Any] in
      let s = Store()
      var out: [String: Any] = [
        "cohort": s.cohort, "band": s.band,
        "runningRelease": Store.runningRelease, "currentRelease": s.currentRelease,
        "pendingRelease": s.pendingRelease, "previousRelease": s.previousRelease,
        "shellVersion": s.installedBinaryVersion,
        "baseUrl": s.baseUrl, "appId": s.appId, "shellMajor": s.shellMajor,
      ]
      if s.blockedRelease != 0 { out["blockedRelease"] = s.blockedRelease }
      return out
    }

    AsyncFunction("checkForUpdate") { (apply: Bool) async -> [String: Any] in
      let r: [String: Any]
      do { r = try await Updater.check(Store()) }
      catch { r = ["status": "error", "error": (error as? UpdateError)?.message ?? error.localizedDescription] }
      if apply, r["status"] as? String == "staged" { Self.reloadHost() }
      return r
    }

    Function("markHealthy") { () -> [String: Any] in
      let s = Store()
      let now = Store.now()
      let coldStart = max(0, (Date().timeIntervalSince1970 - Self.processStart()) * 1000)
      let sinceLoad = Store.bundleSelectedAt > 0 ? (now - Store.bundleSelectedAt) * 1000 : -1
      let promoted = ShipvoBundleSelector.promoteIfRunning(s)
      return ["release": Store.runningRelease, "coldStartMs": Int(coldStart), "sinceLoadMs": Int(sinceLoad), "promoted": promoted,
              "kind": Store.loadsInProcess <= 1 ? "cold" : "reload"]
    }

    Function("consumeEvents") { () -> [String] in Store().consumeEvents() }

    Function("rollback") { () in
      let s = Store()
      Store.lock.lock()
      if let p = s.pendingPath { try? FileManager.default.removeItem(atPath: p) }
      s.pendingPath = nil; s.pendingRelease = 0; s.trialBoots = 0
      s.addEvent("rolled_back:\(s.currentRelease)")
      s.block(s.currentRelease)
      ShipvoBundleSelector.revertToPrevious(s)
      Store.lock.unlock()
      Self.reloadHost()
    }

    Function("reload") { () in Self.reloadHost() }
  }

  static func reloadHost() {
    ShipvoBundleSelector.invalidate()
    DispatchQueue.main.async { RCTTriggerReloadCommandListeners("shipvo-update") }
  }

  /// Seconds since 1970 at which this process started.
  static func processStart() -> TimeInterval {
    var info = kinfo_proc(); var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return Date().timeIntervalSince1970 }
    let t = info.kp_proc.p_un.__p_starttime
    return TimeInterval(t.tv_sec) + TimeInterval(t.tv_usec) / 1_000_000
  }
}
