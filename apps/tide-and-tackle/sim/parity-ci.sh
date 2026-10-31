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
adb emu geo fix 9.6967 4.0225      # Bonapriso, Douala: 0.7 km from the shop
adb install -r emu.apk
adb shell monkey -p dev.shipvo.tide -c android.intent.category.LAUNCHER 1
sleep 60                      # first launch: fetch live content and any newer signed release
adb shell am force-stop dev.shipvo.tide
adb shell monkey -p dev.shipvo.tide -c android.intent.category.LAUNCHER 1
sleep 25
# Permission-dialog probe: does the system dialog ever appear on this emulator? (Recorded, not scored.)
{
  echo "== probe: permission dialog on $(adb shell getprop ro.build.version.release)"
  adb shell pm reset-permissions -p dev.shipvo.tide 2>/dev/null || true
  node -e '
    import("./apps/tide-and-tackle/sim/native.mjs").then(async (m) => {
      const { execFileSync } = await import("node:child_process");
      const n = m.dump().find((x) => /^Scan a product barcode$/.test(x.label)); if (!n) { console.log("no Scan button"); return; }
      execFileSync("adb", ["shell", "input", "tap", String(n.x), String(n.y)]);
      for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 500));
        const f = execFileSync("adb", ["shell", "dumpsys", "window"]).toString().split("\n").filter((l) => /mCurrentFocus/.test(l)).join("").trim();
        console.log(`t+${(i + 1) * 500}ms ${f}`); }
      console.log(m.dump().filter((x) => /ermission|Allow|Deny|While using/.test(x.label)).map((x) => x.role + ":" + x.label).join(" | ") || "(no dialog elements)");
      const ok = m.dump().find((x) => x.label === "While using the app"); if (ok) { execFileSync("adb", ["shell", "input", "tap", String(ok.x), String(ok.y)]); await new Promise((r) => setTimeout(r, 1500)); console.log("granted via dialog; now:", m.dump().filter((x) => /Camera preview|Camera unavailable|needed to scan/.test(x.label)).map((x) => x.label).join(" | ")); }
      console.log(execFileSync("adb", ["shell", "dumpsys", "package", "dev.shipvo.tide"]).toString().split("\n").filter((l) => /CAMERA/.test(l) && /granted/.test(l)).join(" ").trim());
    });'
  adb logcat -d | grep -iE "GrantPermissions|PermissionController|permissioncontroller" | tail -5 || true
} 2>&1 | tee probe-permissions.log
# Fresh app for the measured flows: clear app data (Expo remembers "asked" in its own storage, which
# pm reset-permissions does not touch) and runtime permissions, then relaunch and let the update land.
adb shell am force-stop dev.shipvo.tide
adb shell pm clear dev.shipvo.tide
adb shell pm reset-permissions -p dev.shipvo.tide 2>/dev/null || true
adb shell monkey -p dev.shipvo.tide -c android.intent.category.LAUNCHER 1
sleep 45
adb shell am force-stop dev.shipvo.tide
adb shell monkey -p dev.shipvo.tide -c android.intent.category.LAUNCHER 1
sleep 20
timeout 3000 node apps/tide-and-tackle/sim/parity.mjs --out . || true
echo "---- simulator log"; tail -20 "$ROOT/sim.log"
cleanup
exit 0
