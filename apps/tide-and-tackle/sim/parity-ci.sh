#!/usr/bin/env bash
# Runs inside the emulator step: start the simulator here (same step, so it stays alive), install the app,
# let any over-the-air update land, restart, run parity, then STOP the simulator so the step can end.
set -x
ROOT="$(pwd)"
cd apps/tide-and-tackle
CONTENT_FROM=https://purenative-control.purenative.workers.dev node sim/server.mjs > "$ROOT/sim.log" 2>&1 < /dev/null &
SIMPID=$!
cd "$ROOT"
cleanup() { kill "$SIMPID" 2>/dev/null; sleep 1; kill -9 "$SIMPID" 2>/dev/null; pkill -f chrome-headless 2>/dev/null; pkill -f chromium 2>/dev/null; true; }
trap cleanup EXIT
for i in $(seq 1 60); do curl -sf localhost:4545/app/ >/dev/null && break; sleep 1; done
curl -sf -X POST localhost:4545/session -H "content-type: application/json" -d '{"session":"warmup"}' | head -c 300 || { echo "SIMULATOR FAILED"; cat "$ROOT/sim.log"; }
adb install -r emu.apk
adb shell monkey -p dev.purenative.tide -c android.intent.category.LAUNCHER 1
sleep 60                      # first launch: fetch live content and any newer signed release
adb shell am force-stop dev.purenative.tide
adb shell monkey -p dev.purenative.tide -c android.intent.category.LAUNCHER 1
sleep 25
timeout 1800 node apps/tide-and-tackle/sim/parity.mjs --out . || true
echo "---- simulator log"; tail -20 "$ROOT/sim.log"
cleanup
exit 0
