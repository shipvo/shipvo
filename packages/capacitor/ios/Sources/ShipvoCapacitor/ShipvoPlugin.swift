import Capacitor
import Foundation
import ShipvoBundle

/// The native half of @shipvo/capacitor on iOS. Same plugin name (`Shipvo`), methods and results as the Android plugin
/// (`ShipvoNativePlugin` in src/native.ts). It backs the core's key-value store and bundle files, and points the web view
/// at an unpacked bundle. It makes no release decisions: the TypeScript core verifies the signature and hash, and this
/// class checks the hash it is given again before it unpacks.
@objc(ShipvoPlugin)
public class ShipvoPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "ShipvoPlugin"
  public let jsName = "Shipvo"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "kvGet", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "kvSet", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "fileWrite", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "fileRead", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "fileRemove", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "fileList", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "fileClear", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "serve", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
  ]

  private let defaults = UserDefaults(suiteName: "shipvo") ?? .standard
  // Instance state, like the Android plugin: it lasts as long as the bridge, and a new bridge starts on the embedded assets.
  private var serving: String?
  private var servingPath: String?

  private lazy var root: URL = {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("shipvo")
    try? FileManager.default.createDirectory(at: base.appendingPathComponent("bundles"), withIntermediateDirectories: true)
    return base
  }()
  private var bundles: URL { root.appendingPathComponent("bundles") }
  private var served: URL { root.appendingPathComponent("served") }

  private func file(_ name: String?) throws -> URL {
    guard let n = name, n.range(of: "^[A-Za-z0-9._-]{1,128}$", options: .regularExpression) != nil, !n.contains("..") else {
      throw Unzip.Failure(message: "bad file name")
    }
    return bundles.appendingPathComponent(n)
  }

  @objc func kvGet(_ call: CAPPluginCall) {
    guard let key = call.getString("key"), let v = defaults.string(forKey: key) else { call.resolve([:]); return }
    call.resolve(["value": v])
  }

  @objc func kvSet(_ call: CAPPluginCall) {
    guard let key = call.getString("key"), let value = call.getString("value") else { call.reject("key and value are required"); return }
    defaults.set(value, forKey: key)
    // The boot counter must be on disk before the page runs.
    defaults.synchronize()
    call.resolve()
  }

  @objc func fileWrite(_ call: CAPPluginCall) {
    do {
      guard let data = Data(base64Encoded: call.getString("data") ?? "") else { throw Unzip.Failure(message: "bad data") }
      try data.write(to: try file(call.getString("name")), options: .atomic)
      call.resolve()
    } catch { call.reject("could not write: \(error.localizedDescription)") }
  }

  @objc func fileRead(_ call: CAPPluginCall) {
    do { call.resolve(["data": try Data(contentsOf: try file(call.getString("name"))).base64EncodedString()]) }
    catch { call.reject(error.localizedDescription) }
  }

  @objc func fileRemove(_ call: CAPPluginCall) {
    do { try? FileManager.default.removeItem(at: try file(call.getString("name"))); call.resolve() }
    catch { call.reject(error.localizedDescription) }
  }

  @objc func fileList(_ call: CAPPluginCall) {
    let names = ((try? FileManager.default.contentsOfDirectory(atPath: bundles.path)) ?? []).filter { !$0.hasSuffix(".tmp") }.sorted()
    call.resolve(["names": names])
  }

  @objc func fileClear(_ call: CAPPluginCall) {
    for n in (try? FileManager.default.contentsOfDirectory(atPath: bundles.path)) ?? [] { try? FileManager.default.removeItem(at: bundles.appendingPathComponent(n)) }
    try? FileManager.default.removeItem(at: served)
    serving = nil; servingPath = nil
    call.resolve()
  }

  /// Serve a stored bundle. `sha256` is the hash the core verified; it is checked again before unpacking.
  @objc func serve(_ call: CAPPluginCall) {
    do {
      let name = call.getString("name")
      let zip = try Data(contentsOf: try file(name))
      guard let want = call.getString("sha256"), BundleVerify.sha256Hex(zip).lowercased() == want.lowercased() else {
        throw Unzip.Failure(message: "bundle hash does not match")
      }
      try? FileManager.default.removeItem(at: served)
      let target = served.appendingPathComponent(name!)
      try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
      do {
        try Unzip.extract(zip, to: target)
        guard FileManager.default.fileExists(atPath: target.appendingPathComponent("index.html").path) else { throw Unzip.Failure(message: "bundle has no index.html") }
      } catch { try? FileManager.default.removeItem(at: served); throw error }
      DispatchQueue.main.async {
        guard let vc = self.bridge?.viewController as? CAPBridgeViewController else { call.reject("no web view to point at the bundle"); return }
        vc.setServerBasePath(path: target.path)
        self.serving = name; self.servingPath = target.path
        call.resolve()
      }
    } catch { call.reject(error.localizedDescription) }
  }

  /// Which bundle this process is already serving, so the page it loads does not boot again.
  @objc func status(_ call: CAPPluginCall) {
    if let s = serving, servingPath != nil { call.resolve(["serving": s]) } else { call.resolve([:]) }
  }
}
