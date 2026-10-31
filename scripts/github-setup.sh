#!/usr/bin/env bash
# One-off: repo discoverability settings. Run locally with `gh auth login` done (needs admin on shipvo/shipvo).
set -euo pipefail
R=shipvo/shipvo
gh api -X PATCH repos/$R -F has_discussions=true >/dev/null && echo "discussions on"
gh api -X PUT repos/$R/topics \
  -f 'names[]=react-native' -f 'names[]=expo' -f 'names[]=ota-updates' -f 'names[]=react-native-ota' \
  -f 'names[]=codepush-alternative' -f 'names[]=expo-updates' -f 'names[]=mcp' -f 'names[]=model-context-protocol' \
  -f 'names[]=ai-agents' -f 'names[]=agent-native' -f 'names[]=mobile-testing' -f 'names[]=e2e-testing' \
  -f 'names[]=react-native-testing' -f 'names[]=mobile-simulator' -f 'names[]=android' -f 'names[]=ios' \
  -f 'names[]=hermes' -f 'names[]=cloudflare-workers' -f 'names[]=self-hosted' -f 'names[]=typescript' >/dev/null && echo "topics set"
gh label create "good first issue" -R $R -c 7057ff -d "Good for newcomers" 2>/dev/null || true
gh label create "help wanted" -R $R -c 008672 -d "Extra attention is needed" 2>/dev/null || true
echo "done. Upload services/site/public/og.png as the social preview in Settings > General (no API for it)."
