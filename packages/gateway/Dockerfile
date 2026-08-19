# syntax=docker/dockerfile:1.7
ARG BUILDPLATFORM=linux/amd64
FROM --platform=${BUILDPLATFORM} node:22-alpine AS build
WORKDIR /workspace

COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps/console/package.json apps/console/package.json
COPY apps/demo-mcp-tools/package.json apps/demo-mcp-tools/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/policy-engine/package.json packages/policy-engine/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY packages/policy-engine packages/policy-engine
COPY packages/gateway packages/gateway
RUN npm run build --workspace @guardmcp/policy-engine && npm run build --workspace @guardmcp/gateway

FROM node:22-alpine AS runtime
ARG GUARDMCP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3001 \
    GUARDMCP_VERSION=${GUARDMCP_VERSION} \
    # packages/gateway/dist/server.js is flattened to ./dist here, so its usual
    # `../../../policy-packs`-relative default (repo-root-relative, correct for a source
    # checkout) no longer points at anything real — pin it explicitly instead (FR-POL-03 §6).
    POLICY_PACKS_DIR=/app/policy-packs
WORKDIR /app
COPY --from=build --chown=node:node /workspace/packages/gateway/dist ./dist
COPY --from=build --chown=node:node /workspace/packages/policy-engine/package.json ./node_modules/@guardmcp/policy-engine/package.json
COPY --from=build --chown=node:node /workspace/packages/policy-engine/dist ./node_modules/@guardmcp/policy-engine/dist
# @guardmcp/policy-engine's loader imports these at module load time (GMCP-14),
# so they must resolve even though gateway itself never imports them directly.
COPY --from=build --chown=node:node /workspace/node_modules/yaml ./node_modules/yaml
COPY --from=build --chown=node:node /workspace/node_modules/zod ./node_modules/zod
# chokidar (+ its one dependency) power the FR-POL-03 hot-reload watcher.
COPY --from=build --chown=node:node /workspace/node_modules/chokidar ./node_modules/chokidar
COPY --from=build --chown=node:node /workspace/node_modules/readdirp ./node_modules/readdirp
# Baked-in default policy set (overridden by the bind mount in docker-compose.yml's dev stack,
# which is what makes hot-reload observable without rebuilding the image).
COPY --chown=node:node policy-packs ./policy-packs
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
