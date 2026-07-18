# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /workspace

COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps/console/package.json apps/console/package.json
COPY apps/demo-agent/package.json apps/demo-agent/package.json
COPY apps/demo-mcp-tools/package.json apps/demo-mcp-tools/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/policy-engine/package.json packages/policy-engine/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY packages/gateway packages/gateway
RUN npm run build --workspace @guardmcp/gateway

FROM node:22-alpine AS runtime
ARG GUARDMCP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3001 \
    GUARDMCP_VERSION=${GUARDMCP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /workspace/packages/gateway/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
