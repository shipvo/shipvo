#!/bin/sh
# Start the simulator (phones in headless Chromium), then the MCP server that agents talk to.
set -e
node /app/sim/server.mjs --port 4545 --dir /tmp/pn-ui &
for i in $(seq 1 60); do curl -sf localhost:4545/app/ >/dev/null 2>&1 && break; sleep 1; done
# Keys are checked by the Worker in front; the app and scope arrive as headers.
exec node /app/mcp/dist/server.js --http 8787
