#!/usr/bin/env bash
# Exports Hermes bundles of the sample app for the device lab. Run after the APK is built (the APK embeds the
# unmodified source). Writes <outDir>/v1.hbc .. v<N>.hbc (headline changed each time) and crash.hbc (throws at start).
#   make-bundles.sh <outDir> [count]
set -euo pipefail
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"; N="${2:-4}"
APP="$(cd "$(dirname "$0")/../../apps/tide-and-tackle" && pwd)"
cd "$APP"
cp src/release.ts /tmp/release.ts.orig; cp index.ts /tmp/index.ts.orig
trap 'cp /tmp/release.ts.orig src/release.ts; cp /tmp/index.ts.orig index.ts' EXIT
export_one() { # name
  npx expo export --platform android --output-dir "$OUT/x-$1" --clear >/dev/null
  cp "$OUT/x-$1/_expo/static/js/android/"*.hbc "$OUT/$1.hbc"; rm -rf "$OUT/x-$1"
  echo "bundle $1: $(stat -c %s "$OUT/$1.hbc") bytes"
}
for i in $(seq 1 "$N"); do
  sed -i "s/headline: \"[^\"]*\"/headline: \"Device lab build $i\"/" src/release.ts
  export_one "v$i"
done
cp /tmp/release.ts.orig src/release.ts
sed -i '1i throw new Error("device-lab: crash on start");' index.ts
export_one crash
