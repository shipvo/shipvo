package dev.shipvo.runtime

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

class ShipvoRuntimePackage : Package {
  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
    listOf(ShipvoHostHandler(context))
}
