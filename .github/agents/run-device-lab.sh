#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner, so the emulator is up for the whole agent session.
set -u
adb devices
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
export PATH="$HOME/.local/bin:$PATH"
claude -p "$(cat /tmp/agent/prompt.md)" \
  --model "${AGENT_MODEL:-claude-sonnet-5-5}" --max-turns 250 --output-format text \
  --mcp-config '{"mcpServers":{"deepwiki":{"type":"http","url":"https://mcp.deepwiki.com/mcp"}}}' \
  --allowedTools "Bash,Read,Glob,Grep,Edit,MultiEdit,Write,TodoWrite,WebFetch,WebSearch,mcp__deepwiki__read_wiki_structure,mcp__deepwiki__read_wiki_contents,mcp__deepwiki__ask_wiki_question" \
  --disallowedTools "Bash(git push:*),Bash(gh pr merge:*),Bash(gh api:*),Bash(gh release:*),Bash(gh secret:*),Bash(gh workflow:*),Bash(npm publish:*),Bash(pnpm publish:*)" \
  > /tmp/agent/claude.log 2>&1
echo "agent exit: $?"
tail -n 80 /tmp/agent/claude.log
exit 0
