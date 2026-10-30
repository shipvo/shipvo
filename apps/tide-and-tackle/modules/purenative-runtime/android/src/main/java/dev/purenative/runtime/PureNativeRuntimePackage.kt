package dev.purenative.runtime

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

class PureNativeRuntimePackage : Package {
  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
    listOf(PureNativeHostHandler(context))
}
