# Runs the control plane locally with `wrangler dev` (local workerd). For trying Shipvo on your machine, not for production.
# Build from the repo root: docker build -f services/control-plane/Dockerfile .
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/schema/package.json packages/schema/
COPY packages/spec/package.json packages/spec/
COPY services/control-plane/package.json services/control-plane/
RUN pnpm install --frozen-lockfile --filter @shipvo/control-plane...
COPY packages/schema packages/schema
RUN pnpm --filter @shipvo/schema build
COPY packages/spec packages/spec
RUN pnpm --filter @shipvo/spec build
COPY services/control-plane services/control-plane
RUN cp services/control-plane/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
WORKDIR /repo/services/control-plane
ENV SHIPVO_PERSIST_DIR=/data
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["sh", "/usr/local/bin/docker-entrypoint.sh"]
