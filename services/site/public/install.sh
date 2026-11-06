#!/bin/sh
# Shipvo installer for the current project. Source: https://github.com/shipvo/shipvo/blob/main/services/site/public/install.sh
# It checks Node and npm, then runs `npx -y @shipvo/cli agents setup` here. It installs nothing else and never uses sudo.
set -eu

say() { printf '%s\n' "$*"; }

if ! command -v node >/dev/null 2>&1; then
  say "Shipvo needs Node 22 or newer, and node was not found."
  say "Install it, then run this again:"
  say "  macOS:         brew install node@22"
  say "  Linux/WSL:     https://nodejs.org/en/download (or your package manager, or nvm)"
  say "  Any system:    https://nodejs.org/en/download"
  exit 1
fi

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
case "$major" in
  ''|*[!0-9]*) major=0 ;;
esac
if [ "$major" -lt 22 ]; then
  say "Shipvo needs Node 22 or newer. Found Node $(node -v 2>/dev/null || echo unknown)."
  say "Install a newer Node from https://nodejs.org/en/download, then run this again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  say "npm was not found. It comes with Node: https://nodejs.org/en/download"
  exit 1
fi

say "Shipvo setup in: $(pwd)"
say "About to run: npx -y @shipvo/cli agents setup"
say "It writes an AGENTS.md section and .mcp.json in this folder. Nothing is installed outside the project."
npx -y @shipvo/cli agents setup

say ""
say "Next:"
say "  1. Open this folder in your coding agent (Claude Code, Cursor, Codex)."
say "  2. Ask it: \"Set up Shipvo in this project, then follow what shipvo prints.\""
say "  3. Docs: https://shipvo.dev/setup/"
