# The hosted simulator: headless Chromium + the Shipvo UI simulator + the MCP server over HTTP.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production PN_SIM=http://localhost:4545 PORT=8787
WORKDIR /app
# The simulator is a single file over Playwright; the MCP server needs the SDK and zod.
RUN npm i -g playwright@1.63.0 && npm i @modelcontextprotocol/sdk@1.32.2 zod@3.23.8
# Staged by the deploy workflow (wrangler's build context is this directory): build/sim/server.mjs, build/mcp/dist, entry.sh
COPY build/sim/server.mjs ./sim/server.mjs
COPY build/mcp/dist ./mcp/dist
COPY entry.sh ./entry.sh
RUN chmod +x ./entry.sh
EXPOSE 8787
CMD ["./entry.sh"]
