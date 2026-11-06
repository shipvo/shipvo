#!/usr/bin/env bash
# Installs ffmpeg and ffprobe (with libx264) on a CI runner. Used by ci.yml and _agent-claude.yml.
#
# Why a script: on some ubuntu-latest runners the apt mirror stalls. The plain
# `apt-get update && apt-get install ffmpeg` step then hung for 20+ minutes with no output
# (ci runs 42128194280 and 42129403594), and the Chromium apt step took 8 minutes (run 42122333584).
# Here every apt network read times out and retries, recommends are skipped (far fewer downloads),
# `apt-get update` is skipped when install-chromium.sh refreshed the lists a moment ago, and each try
# is capped so a stalled mirror fails the try instead of the whole job.
set -uo pipefail

if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then ffmpeg -version | head -1; exit 0; fi

SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
APT_OPTS=(-o DPkg::Lock::Timeout=120 -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)

for a in 1 2 3; do
  if [ -z "$(find /var/lib/apt/lists -maxdepth 1 -name '*InRelease' -mmin -30 2>/dev/null | head -1)" ] || [ "$a" -gt 1 ]; then
    timeout 300 $SUDO apt-get "${APT_OPTS[@]}" update -qq || { echo "apt-get update failed or timed out (try $a)"; sleep $(( a * 10 )); continue; }
  fi
  if timeout 480 $SUDO env DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTS[@]}" install -y -qq --no-install-recommends ffmpeg >/dev/null; then
    break
  fi
  echo "apt-get install ffmpeg failed or timed out (try $a)"; sleep $(( a * 10 ))
done

command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo "::error::could not install ffmpeg"; exit 1; }
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264 || { echo "::error::ffmpeg has no libx264"; exit 1; }
ffmpeg -version | head -1
