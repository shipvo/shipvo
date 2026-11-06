#!/usr/bin/env bash
# Installs Playwright's Chromium and its system packages on a CI runner.
#
# Why not `playwright install --with-deps chromium`: on the ubuntu-latest (26.04) runners the Playwright 1.63
# CLI starts its apt-get step twice at once, and one of the two always fails on /var/lib/apt/lists/lock
# (ci run 42088294598, engineer run 42082643120). Here apt runs once, from this script, after any other
# apt process has finished. Run after `pnpm install`, from any folder.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
PW="pnpm exec playwright-core"
APT_OPTS=(-o DPkg::Lock::Timeout=120 -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)

wait_for_apt() {
  for _ in $(seq 1 120); do
    pgrep -x apt-get >/dev/null || pgrep -x apt >/dev/null || pgrep -x dpkg >/dev/null || return 0
    sleep 2
  done
  echo "::warning::another apt process is still running after 4 minutes"
}

ok=""
for a in 1 2 3 4; do
  # The dry run only simulates (apt-get install -s), so it needs no lock. Lines "  <package>" list what is missing.
  out=$($PW install-deps --dry-run chromium 2>&1)
  if grep -q "All system dependencies are installed" <<<"$out"; then ok=1; break; fi
  pkgs=$(sed -n 's/^  \([a-z0-9][a-z0-9.+-]*\)$/\1/p' <<<"$out" | sort -u | tr '\n' ' ')
  if [ -z "${pkgs// /}" ]; then echo "$out"; echo "::warning::could not read the missing package list (try $a)"; sleep 10; continue; fi
  echo "Installing system packages for Chromium (try $a): $pkgs"
  wait_for_apt
  # shellcheck disable=SC2086
  # Network reads time out and retry, and each call is capped: a stalled mirror otherwise hangs the job (ci run 42128194280).
  timeout 300 $SUDO apt-get "${APT_OPTS[@]}" update -qq && \
    timeout 480 $SUDO apt-get "${APT_OPTS[@]}" install -y -qq --no-install-recommends $pkgs && { ok=1; break; }
  sleep $(( a * 10 ))
done
[ -n "$ok" ] || { echo "::error::could not install Chromium's system packages"; exit 1; }

for a in 1 2 3; do
  $PW install chromium && exit 0
  echo "Chromium download failed (try $a)"; sleep $(( a * 10 ))
done
echo "::error::could not download Chromium"
exit 1
