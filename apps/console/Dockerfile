# syntax=docker/dockerfile:1.7
ARG BUILDPLATFORM=linux/amd64
FROM --platform=${BUILDPLATFORM} node:22-alpine AS build
ARG TARGETARCH=amd64
WORKDIR /workspace

COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps/console/package.json apps/console/package.json
COPY apps/demo-agent/package.json apps/demo-agent/package.json
COPY apps/demo-mcp-tools/package.json apps/demo-mcp-tools/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/policy-engine/package.json packages/policy-engine/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/console apps/console
RUN npm run build --workspace @guardmcp/console
RUN --mount=type=cache,target=/root/.npm \
    set -eux; \
    case "$TARGETARCH" in amd64) npm_cpu=x64 ;; arm64) npm_cpu=arm64 ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac; \
    mkdir -p /target-dependencies/apps/console /target-dependencies/apps/demo-agent \
      /target-dependencies/apps/demo-mcp-tools /target-dependencies/packages/gateway \
      /target-dependencies/packages/policy-engine; \
    cp package*.json /target-dependencies/; \
    cp apps/console/package.json /target-dependencies/apps/console/; \
    cp apps/demo-agent/package.json /target-dependencies/apps/demo-agent/; \
    cp apps/demo-mcp-tools/package.json /target-dependencies/apps/demo-mcp-tools/; \
    cp packages/gateway/package.json /target-dependencies/packages/gateway/; \
    cp packages/policy-engine/package.json /target-dependencies/packages/policy-engine/; \
    cd /target-dependencies; \
    npm_config_cpu="$npm_cpu" npm_config_os=linux npm ci --ignore-scripts --omit=dev; \
    rm -rf /workspace/apps/console/.next/standalone/node_modules/@img; \
    cp -R /target-dependencies/node_modules/@img /workspace/apps/console/.next/standalone/node_modules/@img

FROM node:22-alpine AS runtime
ARG GUARDMCP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GUARDMCP_VERSION=${GUARDMCP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/console/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/console/.next/static ./apps/console/.next/static
USER node
EXPOSE 3000
CMD ["sh", "-ec", "if [ -f apps/console/server.js ]; then exec node apps/console/server.js; else exec node server.js; fi"]
