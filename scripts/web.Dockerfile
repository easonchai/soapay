# Soapay web: company app + landing at /, employee app at /app/, docs at /docs/, /api proxied to the API service.
# Build from the repo root. Public settings arrive as build args (Railway passes service variables).
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
ARG PUBLIC_ORIGIN
ARG VITE_CHAIN_ID=84532
ARG VITE_STEALTH_DISPERSE
ARG VITE_ATTESTER
ARG VITE_RPC_URL=https://sepolia.base.org
ARG VITE_ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ARG VITE_BUNDLER_URL=https://public.pimlico.io/v2/84532/rpc
# Base Sepolia pay token (D-52). Empty = the SDK default, Soapay's mock USDC.
ARG VITE_PAY_TOKEN=
# Reown (WalletConnect) project id for the employee app's "Connect to a dApp" (D-61). Public; empty = off.
ARG VITE_WALLETCONNECT_PROJECT_ID=
ENV VITE_CHAIN_ID=$VITE_CHAIN_ID VITE_STEALTH_DISPERSE=$VITE_STEALTH_DISPERSE VITE_ATTESTER=$VITE_ATTESTER \
    VITE_RPC_URL=$VITE_RPC_URL VITE_ENS_RPC_URL=$VITE_ENS_RPC_URL VITE_BUNDLER_URL=$VITE_BUNDLER_URL \
    VITE_PAY_TOKEN=$VITE_PAY_TOKEN VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
COPY . .
RUN pnpm install --frozen-lockfile --filter "@soapay/recipient..." --filter "@soapay/sender..." --filter "@soapay/docs..."
RUN bash scripts/build-demo.sh "$PUBLIC_ORIGIN"

FROM node:24-slim
WORKDIR /app
COPY --from=build /repo/scripts/serve-demo.mjs scripts/serve-demo.mjs
COPY --from=build /repo/apps/recipient/dist apps/recipient/dist
COPY --from=build /repo/apps/sender/dist apps/sender/dist
COPY --from=build /repo/apps/docs/dist apps/docs/dist
ENV HOST=0.0.0.0
CMD ["node", "scripts/serve-demo.mjs"]
