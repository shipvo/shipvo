import ExpoModulesCore

/// Global state that is set when the module is created and cleared when it is destroyed on a reload.
enum BusyState {
  static let lock = NSLock()
  static var value = ""
  static func set(_ v: String) { lock.lock(); value = v; lock.unlock() }
  static func get() -> String { lock.lock(); defer { lock.unlock() }; return value }
}

public class BusyStateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BusyState")
    OnCreate { BusyState.set("ready") }
    OnDestroy { BusyState.set("") }
    Function("get") { () -> String in BusyState.get() }
  }
}
