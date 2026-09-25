---
name: decision-app-stack
description: Monorepo tooling and app framework choices (pnpm+turbo, Vite React SPAs, Hono gateway)
metadata:
  type: project
---
pnpm workspaces + Turborepo, TypeScript 7. Recipient and sender apps are Vite + React static SPAs (wagmi, viem, TanStack Query). Gateway is Hono on Node, bundled with esbuild. Shared logic lives in `@soapay/sdk`.

**Why:** key-holding apps must never route through a server we run; a static SPA can be hosted anywhere (IPFS/CDN). Decided 2026-09-25.
**How to apply:** no SSR or API routes in the apps; anything server-side goes in `apps/gateway`. Apps and gateway consume only `@soapay/sdk` (PRD P0: no private code paths). Related: [[scopelift-sdk-esm-quirk]].
