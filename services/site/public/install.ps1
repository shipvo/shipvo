# Shipvo installer for the current project, for Windows PowerShell 5.1 and PowerShell 7.
# Source: https://github.com/shipvo/shipvo/blob/main/services/site/public/install.ps1
# Usage, in your project folder:  irm https://shipvo.dev/install.ps1 | iex
# It checks Node and npm, then runs `npx -y @shipvo/cli agents setup` here. It installs nothing else and needs no admin rights.
$ErrorActionPreference = "Stop"

function Say($text) { Write-Host $text }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say "Shipvo needs Node 22 or newer, and node was not found."
  Say "Install it, then run this again:"
  Say "  winget install OpenJS.NodeJS.LTS"
  Say "  or download it from https://nodejs.org/en/download"
  return
}

$major = 0
try { $major = [int](& node -p "process.versions.node.split('.')[0]") } catch { $major = 0 }
if ($major -lt 22) {
  $found = (& node -v) 2>$null
  Say "Shipvo needs Node 22 or newer. Found Node $found."
  Say "Update it with: winget upgrade OpenJS.NodeJS.LTS  (or https://nodejs.org/en/download), then run this again."
  return
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Say "npx was not found. It comes with Node: https://nodejs.org/en/download"
  return
}

Say "Shipvo setup in: $((Get-Location).Path)"
Say "About to run: npx -y @shipvo/cli agents setup"
Say "It writes an AGENTS.md section and .mcp.json in this folder. Nothing is installed outside the project."
& npx -y @shipvo/cli agents setup
if ($LASTEXITCODE -ne 0) { Say "Setup failed. See the output above."; return }

Say ""
Say "Next:"
Say "  1. Open this folder in your coding agent (Claude Code, Cursor, Codex)."
Say "  2. Ask it: ""Set up Shipvo in this project, then follow what shipvo prints."""
Say "  3. Docs: https://shipvo.dev/setup/"
