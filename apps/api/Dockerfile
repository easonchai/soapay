# Soapay API. Build from the repo root (the SDK is a workspace dependency):
#   docker build -f apps/api/Dockerfile -t soapay-api .
#   docker run -p 8787:8787 -v soapay-data:/data --env-file apps/api/.env soapay-api

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@soapay/api..."
COPY packages/sdk packages/sdk
COPY apps/api apps/api
RUN pnpm --filter @soapay/sdk build && pnpm --filter @soapay/api build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/soapay.db
WORKDIR /app
# The bundle is self-contained (esbuild inlines viem, hono and the ScopeLift SDK).
COPY --from=build /repo/apps/api/dist/index.js ./index.js
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "index.js"]
