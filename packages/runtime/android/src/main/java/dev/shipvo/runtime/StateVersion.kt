package dev.shipvo.runtime

/** The `state_version` kept next to each release id. 0 means the release declared none. `Store` implements it; tests use an in-memory copy. */
internal interface StateVersions {
  val pendingRelease: Int
  val currentRelease: Int
  var pendingStateVersion: Int
  var currentStateVersion: Int
  var previousStateVersion: Int
}

/** How the state version follows a release through stage, apply and revert. Free of Android types so a plain JVM test can run it. */
internal object StateVersion {
  /** Keep the signed pointer's `state_version` with the release being staged. Absent or not a positive integer stays absent (0). */
  fun stage(c: StateVersions, fromPointer: Any?) { c.pendingStateVersion = (fromPointer as? Int)?.takeIf { it > 0 } ?: 0 }
  /** The pending release became current. Call before the release ids move. */
  fun promote(c: StateVersions) {
    c.previousStateVersion = c.currentStateVersion; c.currentStateVersion = c.pendingStateVersion; c.pendingStateVersion = 0
  }
  /** The pending release was dropped. */
  fun dropPending(c: StateVersions) { c.pendingStateVersion = 0 }
  /** The current release was replaced by the previous one (or by the embedded bundle, when there is none). */
  fun revert(c: StateVersions) { c.currentStateVersion = c.previousStateVersion; c.previousStateVersion = 0 }
  /** The version of the bundle running now, or null for the embedded bundle or a release that declared none. */
  fun applied(c: StateVersions, runningRelease: Int): Int? {
    val v = when {
      runningRelease == 0 -> 0
      runningRelease == c.pendingRelease -> c.pendingStateVersion
      runningRelease == c.currentRelease -> c.currentStateVersion
      else -> 0
    }
    return v.takeIf { it > 0 }
  }
}
