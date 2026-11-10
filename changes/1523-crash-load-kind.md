- `@shipvo/runtime`: an uncaught JS error now queues a `js_crash:<cold|reload>` event, and `reportRuntimeEvents` sends it as `js_crash_cold` or `js_crash_reload`. Crash reports say whether the crash happened on a cold start or after an in-place reload, on Android and iOS.
- `@shipvo/schema`: the telemetry `event` enum accepts `js_crash_cold` and `js_crash_reload`.
- Migration: none; shells without this change send no `js_crash_*` events.

- `@shipvo/runtime`: a `crash_loop_revert` event now says which load it happened in (`cold` or `reload`). The native event is `crash_loop_revert:<release>:<kind>` and the telemetry report body carries `load_kind`.
- `@shipvo/schema`: `Telemetry` has an optional `load_kind`.
- Migration: none. Older shells send events without a kind, and `load_kind` is left out.
