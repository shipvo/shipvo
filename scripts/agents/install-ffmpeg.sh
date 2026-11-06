#!/usr/bin/env bash
# Installs ffmpeg and ffprobe (with libx264) on a CI runner. Used by ci.yml and _agent-claude.yml.
#
# Why a script: on some ubuntu-latest runners the apt mirror stalls. The plain
# `apt-get update && apt-get install ffmpeg` step then hung for 20+ minutes with no output
# (ci runs 42128194280 and 42129403594), and the Chromium apt step took 8 minutes (run 42122333584).
# Here every apt network read times out and retries, recommends are skipped (far fewer downloads),
# `apt-get update` is skipped when install-chromium.sh refreshed the lists a moment ago, and each try
# is capped so a stalled mirror fails the try instead of the whole job.
#
# A stalled mirror stays stalled: in ci runs 42133908808 and 42134007736 all three 8-minute tries hit the
# same runner mirror and failed (33 minutes lost). So tries are now 4 minutes, and tries 2 and 3 switch apt
# to other Ubuntu mirrors. apt output is kept (last lines) so the next stall shows which host hangs.
set -uo pipefail

if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then ffmpeg -version | head -1; exit 0; fi

SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"

# First choice: a static ffmpeg build (GPL, includes libx264) from GitHub releases. apt stalled on every
# mirror for a whole hour (escalations #561, #563, #564, #572; ci run 42141993808), while GitHub release
# downloads are fast and reliable from runners. apt below is only the fallback.
static_ffmpeg() {
  local arch url dir
  case "$(uname -m)" in x86_64) arch=linux64 ;; aarch64|arm64) arch=linuxarm64 ;; *) return 1 ;; esac
  url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${arch}-gpl.tar.xz"
  dir=$(mktemp -d)
  for t in 1 2 3; do
    if curl -fsSL --retry 2 --connect-timeout 20 --max-time 240 "$url" -o "$dir/ff.tar.xz" &&
       tar -xJf "$dir/ff.tar.xz" -C "$dir" --wildcards --strip-components=2 '*/bin/ffmpeg' '*/bin/ffprobe'; then
      $SUDO install -m 0755 "$dir/ffmpeg" "$dir/ffprobe" /usr/local/bin/ && rm -rf "$dir" && hash -r && return 0
    fi
    echo "static ffmpeg download failed (try $t)"; sleep 5
  done
  rm -rf "$dir"; return 1
}
if static_ffmpeg && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264; then
  echo "Installed static ffmpeg"; ffmpeg -version | head -1; exit 0
fi
echo "Static ffmpeg not available, falling back to apt"
APT_OPTS=(-o DPkg::Lock::Timeout=120 -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
MIRRORS=("" "http://archive.ubuntu.com/ubuntu/" "http://mirrors.edge.kernel.org/ubuntu/")
LOG=$(mktemp)

# Point the main Ubuntu archive (not security) at another mirror. Handles deb822 and one-line sources.
use_mirror() {
  local m="$1" f
  for f in /etc/apt/sources.list.d/*.sources /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$f" ] || continue
    $SUDO sed -i -E "s#https?://[a-z0-9.-]*(archive|mirror)[a-z0-9.-]*/(pub/)?ubuntu/?([[:space:]]|\$)#${m}\3#g" "$f"
  done
  echo "Switched apt to mirror $m"
}

for a in 1 2 3; do
  m="${MIRRORS[$((a - 1))]}"
  [ -n "$m" ] && use_mirror "$m"
  if [ -z "$(find /var/lib/apt/lists -maxdepth 1 -name '*InRelease' -mmin -30 2>/dev/null | head -1)" ] || [ "$a" -gt 1 ]; then
    timeout 180 $SUDO apt-get "${APT_OPTS[@]}" update -qq || { echo "apt-get update failed or timed out (try $a)"; sleep 5; continue; }
  fi
  if timeout 240 $SUDO env DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTS[@]}" install -y -q --no-install-recommends ffmpeg >"$LOG" 2>&1; then
    break
  fi
  echo "apt-get install ffmpeg failed or timed out (try $a). Last apt output:"; tail -n 8 "$LOG"; sleep 5
done

command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { echo "::error::could not install ffmpeg"; exit 1; }
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264 || { echo "::error::ffmpeg has no libx264"; exit 1; }
ffmpeg -version | head -1
