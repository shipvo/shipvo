import Capacitor
import Foundation
import ShipvoBundle

/// The native half of @shipvo/capacitor on iOS. It backs the core's KeyValueStore (UserDefaults) and
/// BundleFiles (the app's Application Support directory), and points the web view at an unpacked bundle.
/// It makes no release decisions and verifies no signatures: the TypeScript core does both.
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

    private static let prefix = "shipvo.kv."
    private let defaults = UserDefaults.standard
    // Instance state: it lives as long as the Bridge. A new Bridge starts on the embedded assets, so it must boot again.
    private let lock = NSLock()
    private var serving: String?
    private var servingPath: String?
    private lazy var store: BundleStore = {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return BundleStore(root: base.appendingPathComponent("shipvo", isDirectory: true))
    }()

    @objc func kvGet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = defaults.string(forKey: Self.prefix + key) else { return call.resolve() }
        call.resolve(["value": value])
    }

    @objc func kvSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else { return call.reject("key and value are required") }
        defaults.set(value, forKey: Self.prefix + key)
        // The boot counter must be on disk before the page runs. Apple discourages synchronize(), but a
        // crash right after this call would otherwise lose the increment and defeat crash-loop detection.
        // If the write fails, UserDefaults gives no error: the value is lost, the core sees the old counter, and
        // the worst case is one missed boot count, not a wrong release.
        defaults.synchronize()
        call.resolve()
    }

    @objc func fileWrite(_ call: CAPPluginCall) {
        guard let data = Data(base64Encoded: call.getString("data") ?? "") else { return call.reject("data is not base64") }
        do { try store.write(call.getString("name"), data); call.resolve() } catch { call.reject("\(error)") }
    }

    @objc func fileRead(_ call: CAPPluginCall) {
        do { call.resolve(["data": try store.read(call.getString("name")).base64EncodedString()]) } catch { call.reject("\(error)") }
    }

    @objc func fileRemove(_ call: CAPPluginCall) {
        do { try store.remove(call.getString("name")); call.resolve() } catch { call.reject("\(error)") }
    }

    @objc func fileList(_ call: CAPPluginCall) { call.resolve(["names": store.list()]) }

    @objc func fileClear(_ call: CAPPluginCall) {
        store.clear()
        lock.lock(); serving = nil; servingPath = nil; lock.unlock()
        call.resolve()
    }

    /// Serve a stored bundle. `sha256` is the hash the core verified; it is checked again before unpacking.
    @objc func serve(_ call: CAPPluginCall) {
        let name = call.getString("name")
        do {
            let dir = try store.unpack(name, expectedSha256: call.getString("sha256"))
            let path = dir.standardizedFileURL.path
            DispatchQueue.main.async { [weak self] in
                guard let self = self, let vc = self.bridge?.viewController as? CAPBridgeViewController else {
                    return call.reject("web view is not ready")
                }
                self.lock.lock(); self.serving = name; self.servingPath = path; self.lock.unlock()
                vc.setServerBasePath(path: path)
                // The web view now points at the new directory, so the old ones can go.
                // Deleting a large bundle can be slow, so it runs off the main thread.
                DispatchQueue.global(qos: .utility).async { self.store.retire(keeping: dir) }
                call.resolve()
            }
        } catch { call.reject("\(error)") }
    }

    /// Which bundle this process is already serving, so the page it loads does not boot again.
    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return call.resolve() }
            self.lock.lock(); let s = self.serving, p = self.servingPath; self.lock.unlock()
            // Report serving only while this Bridge still points at the unpacked directory.
            if let s = s, let p = p, self.bridge?.config.appLocation.standardizedFileURL.path == p { call.resolve(["serving": s]) } else { call.resolve() }
        }
    }
}
