#!/usr/bin/env bash
# Builds the scene-based host (packages/runtime/ios-scene-host) for the iOS Simulator, installs it on $SIM_UDID and runs
# the trial-boot cases against the fixture control plane. Env: SIM_UDID, SHIPVO_FIXTURE_BASE, SHIPVO_FIXTURE_DIR, OUT_DIR.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IOS="$HERE/../ios"
: "${SIM_UDID:?}" "${SHIPVO_FIXTURE_BASE:?}" "${SHIPVO_FIXTURE_DIR:?}" "${OUT_DIR:?}"
mkdir -p "$OUT_DIR"
APP="$OUT_DIR/SceneHost.app"
BUNDLE_ID=dev.shipvo.scenehost
KEY="$(node -p "require('$SHIPVO_FIXTURE_DIR/meta.json').publicKey")"

echo "== build"
rm -rf "$APP"; mkdir -p "$APP"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH=x86_64
SRC=()
for f in Store Verify Updater Patch HermesGuard BundleSelector Rotation ForegroundWatcher; do SRC+=("$IOS/$f.swift"); done
xcrun swiftc -sdk "$SDK" -target "$ARCH-apple-ios16.4-simulator" -module-name SceneHost -Onone \
  -o "$APP/SceneHost" "${SRC[@]}" "$HERE/main.swift" 2>&1 | tee "$OUT_DIR/build.log"
# main.swift has top-level code, so it is the entry point.
cp "$HERE/Info.plist" "$APP/Info.plist"
codesign --force --sign - "$APP"

echo "== install"
xcrun simctl install "$SIM_UDID" "$APP"
DATA="$(xcrun simctl get_app_container "$SIM_UDID" "$BUNDLE_ID" data)"
RESULT="$DATA/tmp/result.json"

# run_case <case>: launch a fresh process, wait for its result file, print it.
run_case() {
  rm -f "$RESULT"
  xcrun simctl launch --terminate-running-process "$SIM_UDID" "$BUNDLE_ID" \
    --case "$1" --base "$SHIPVO_FIXTURE_BASE" --key "$KEY" --out "$RESULT" > "$OUT_DIR/launch-$1.log" 2>&1
  for _ in $(seq 1 60); do [ -f "$RESULT" ] && break; sleep 0.5; done
  [ -f "$RESULT" ] || { echo "FAIL: no result from case $1"; cat "$OUT_DIR/launch-$1.log"; exit 1; }
  sleep 0.2; cat "$RESULT" >> "$OUT_DIR/results.log"; echo >> "$OUT_DIR/results.log"
  cat "$RESULT"; echo
}
# field <name>: read a number or string from the last result.
field() { node -p "String(JSON.parse(require('fs').readFileSync('$RESULT','utf8'))['$1'])"; }
FAILED=0
expect() { # expect <label> <field> <want>
  local got; got="$(field "$2")"
  if [ "$got" = "$3" ]; then echo "ok   $1 ($2=$got)"; else echo "FAIL $1: $2=$got, want $3"; FAILED=1; fi
}
stage() { run_case stage; expect "staged a release" status staged; expect "pending release" pendingRelease 5; }

echo "== case 1: a staged release loads once and counts one trial boot"
stage
run_case load
expect "scene connected" scene true
expect "one trial boot" trialBoots 1
expect "ran the staged release" runningRelease 5

echo "== case 2: a background wake with no scene counts none"
stage
run_case bgload
expect "no scene" scene false
expect "no trial boot" trialBoots 0
expect "still pending" pendingRelease 5

echo "== case 3: markHealthy clears the trial"
stage
run_case load
expect "one trial boot before healthy" trialBoots 1
run_case healthy
expect "promoted" promoted true
expect "current release" currentRelease 5
expect "no pending release" pendingRelease 0
expect "trial boots cleared" trialBoots 0

echo "== case 4: three unhealthy loads roll back"
stage
for n in 1 2 3; do run_case load; expect "unhealthy load $n" trialBoots "$n"; done
run_case load
expect "rolled back to the embedded bundle" runningRelease 0
expect "release blocked" blockedRelease 5
expect "no pending release" pendingRelease 0

if [ "$FAILED" -ne 0 ]; then echo "scene-host: FAILED"; exit 1; fi
echo "scene-host: all cases passed"
