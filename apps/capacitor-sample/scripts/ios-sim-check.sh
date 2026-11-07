#!/usr/bin/env bash
# Runs the sample app on an iOS Simulator and checks three cases against a local signed update server:
#   apply    a signed bundle v2 is applied          -> the page shows v2
#   rollback a bundle that fails at launch          -> after 3 trial boots the next launch shows v1
#   refused  a bundle with a wrong signature        -> the page stays on v1
# Needs macOS, Xcode, Node 22 and pnpm. Usage: scripts/ios-sim-check.sh   (env: DEVICE_NAME, PORT, SETTLE)
set -euo pipefail

cd "$(dirname "$0")/.."
DEVICE_NAME="${DEVICE_NAME:-iPhone 16}"
PORT="${PORT:-8787}"
SETTLE="${SETTLE:-6}"          # seconds to let a launch finish
BUNDLE_ID="dev.shipvo.capacitorsample"
WORK="$(mktemp -d)"
EVENTS="$WORK/events.log"; MODE="$WORK/mode"; : > "$EVENTS"
SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true; xcrun simctl shutdown "${UDID:-}" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; echo "--- server events ---" >&2; cat "$EVENTS" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "this script needs macOS with Xcode"

# 1. Keys, then an app built with the public key and the local server URL.
PUBLIC_KEY="$(node scripts/ios-sim-keys.mjs "$WORK/keys.json")"
export SHIPVO_PUBLIC_KEY="$PUBLIC_KEY" SHIPVO_BASE_URL="http://127.0.0.1:$PORT" SHIPVO_SIM_CHECK=1
pnpm sync
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" -derivedDataPath "$WORK/dd" build > "$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log" >&2; fail "xcodebuild failed"; }
APP="$(find "$WORK/dd/Build/Products" -name App.app -maxdepth 2 | head -1)"
[ -n "$APP" ] || fail "App.app not found after build"

# 2. Update server and simulator.
echo good > "$MODE"
node scripts/ios-sim-server.mjs "$WORK/keys.json" www "$MODE" "$EVENTS" "$PORT" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
UDID="$(xcrun simctl list devices available | grep -F "$DEVICE_NAME (" | head -1 | grep -Eo '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}')" || fail "no available simulator named '$DEVICE_NAME'"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b > /dev/null

versions() { grep -c '^version ' "$EVENTS" || true; }
last_version() { grep '^version ' "$EVENTS" | tail -1 | cut -d' ' -f2; }
# wait_report <count before>: wait for a new "version" line, then let the launch settle.
wait_report() {
  for _ in $(seq 1 60); do [ "$(versions)" -gt "$1" ] && { sleep 2; return; }; sleep 1; done
  fail "the app reported no version within 60 seconds"
}
fresh_install() { xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true; xcrun simctl install "$UDID" "$APP"; : > "$EVENTS"; }
launch() { xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true; xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null; }
expect() { [ "$2" = "$3" ] || fail "$1: expected $3, the page shows '$2'"; echo "$1: $2"; }

# 3. Apply. The first launch shows v1, downloads v2, and the reloaded page shows v2.
fresh_install; echo good > "$MODE"
launch
for _ in $(seq 1 60); do [ "$(last_version)" = "v2" ] && break; sleep 1; done
expect "apply" "$(last_version)" v2
grep -q '^bundle 2' "$EVENTS" || fail "apply: the app never downloaded bundle v2"

# 4. Rollback. The bundle throws at load and never reports healthy. Launches 1 to 3 are its trial boots; launch 4 reverts.
fresh_install; echo crash > "$MODE"
launch
for _ in $(seq 1 60); do grep -q '^bundle 2' "$EVENTS" && break; sleep 1; done
grep -q '^bundle 2' "$EVENTS" || fail "rollback: the app never downloaded the failing bundle"
sleep "$SETTLE"
for _ in 2 3; do launch; sleep "$SETTLE"; done
before="$(versions)"; launch; wait_report "$before"
expect "rollback" "$(last_version)" v1

# 5. Refused. A pointer signed with another key must not apply.
fresh_install; echo badsig > "$MODE"
launch
for _ in $(seq 1 30); do grep -q '^pointer badsig' "$EVENTS" && break; sleep 1; done
grep -q '^pointer badsig' "$EVENTS" || fail "refused: the app never asked for the pointer"
sleep "$SETTLE"
grep -q '^bundle ' "$EVENTS" && fail "refused: the app downloaded a bundle with a wrong signature"
expect "refused bad signature" "$(last_version)" v1

echo "OK: apply v2, rollback v1, refused bad signature v1"
