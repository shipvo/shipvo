#!/usr/bin/env bash
# Builds the sample shell APK (x86_64) for the emulator, pointed at a local release server with a test key.
#   build-apk.sh <publicKeyB64> <port> <out.apk>
# app.json is rewritten for the build and restored afterwards. The generated android/ directory is left in
# place (it is not committed) so a second build is incremental.
set -euo pipefail
PUB="$1"; PORT="$2"; OUT="$3"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/apps/tide-and-tackle"
cp "$APP/app.json" /tmp/app.json.orig
trap 'cp /tmp/app.json.orig "$APP/app.json"' EXIT
node -e '
  const fs = require("fs"), f = process.argv[1], j = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = j.expo.plugins.find((x) => Array.isArray(x) && x[0] === "@shipvo/runtime");
  p[1].baseUrl = "http://10.0.2.2:" + process.argv[3]; p[1].publicKey = process.argv[2];
  fs.writeFileSync(f, JSON.stringify(j, null, 2));' "$APP/app.json" "$PUB" "$PORT"
cd "$APP"
CI=1 npx expo prebuild -p android --no-install --clean
# Test build only: allow cleartext http to the local server, and make the app debuggable so `adb shell run-as` can read
# the runtime state (this does not turn on React Native dev support; the release bundle logic is unchanged).
sed -i 's/<application /<application android:usesCleartextTraffic="true" android:debuggable="true" /' android/app/src/main/AndroidManifest.xml
cd android && ./gradlew assembleRelease -x lintVitalRelease -PreactNativeArchitectures=x86_64 --no-daemon
cp app/build/outputs/apk/release/*.apk "$OUT"
echo "built $OUT"
