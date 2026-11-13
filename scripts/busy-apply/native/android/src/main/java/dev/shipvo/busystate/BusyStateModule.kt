package dev.shipvo.busystate

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Global state that is set when the module is created and cleared when it is destroyed on a reload. */
object BusyState {
  @Volatile var value: String = ""
}

class BusyStateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BusyState")
    OnCreate { BusyState.value = "ready" }
    OnDestroy { BusyState.value = "" }
    Function("get") { BusyState.value }
  }
}
