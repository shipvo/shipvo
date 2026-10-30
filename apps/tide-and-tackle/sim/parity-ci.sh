#!/usr/bin/env bash
# Runs inside the emulator step: install the app, let any over-the-air update land, restart, then run parity.
set -x
adb install -r emu.apk
adb shell monkey -p dev.purenative.tide -c android.intent.category.LAUNCHER 1
sleep 60                      # first launch: fetch live content and any newer signed release
adb shell am force-stop dev.purenative.tide
adb shell monkey -p dev.purenative.tide -c android.intent.category.LAUNCHER 1
sleep 25
adb shell uiautomator dump /sdcard/pn.xml && adb shell cat /sdcard/pn.xml | head -c 600; echo
node apps/tide-and-tackle/sim/parity.mjs --out . || true
