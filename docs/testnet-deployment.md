# Testnet deployment (2026-09-25)

## Public demo (Railway, Aqua0 workspace, project `soapay`)

- **Web:** https://soapay.up.railway.app (landing + company app at `/`, employee app at `/app/`, API proxied at `/api`; the old `/sender/` and `/#/join` links redirect)
- Services: `web` (`scripts/web.Dockerfile`, public origin baked in at build time) and `api` (`apps/api/Dockerfile`, volume at `/data`, reached privately at `api.railway.internal:8787`, no public domain).
- The API secrets are Railway service variables (set from the local `.env`, never committed). The public API runs the strict default rate limits.
- Redeploy after a merge: `railway up --service web` / `--service api` from the repo root (the project is linked), or use the Railway MCP `deploy`.

Public addresses only. Private keys live in the git-ignored `apps/api/.env` and `contracts/.env` on the machine that deployed.

## Base Sepolia (84532)

| What | Address |
| --- | --- |
| `StealthDisperse` (CREATE2, salt `soapay.StealthDisperse.v1`) | `0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA` (deploy block 47290264) |
| Deployer | `0x7757A7C9f4eD02a02353A7929cfb399e9286f52c` |
| ERC-6538 relayer (`RELAYER_PRIVATE_KEY`) | `0x509aD63D73f41FA9DD7162F7FcD3876090C8157F` |
| Canonical Announcer / Registry | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` / `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Bundler (public, keyless) | `https://public.pimlico.io/v2/84532/rpc` (EntryPoint v0.8 supported) |

## Ethereum Sepolia: ENSv2

| What | Address |
| --- | --- |
| `soapay.eth` owner (resolver admin) | `0xC33FcD38117b76CC05dab2F3DD2d9B71111358dB` (expires 2027-09-25) |
| `soapay.eth` subname registry (`ENS_SUBNAME_REGISTRY`) | `0x7403C470a91B21AB77B4E246a39c1Adfcc317969` |
| Issuer (`ISSUER_PRIVATE_KEY`, holds only ROLE_REGISTRAR) | `0x20E69b1fdEB0C945CE8FE758CF3B3B4BBfC0068b` |
| L1 relayer (gas top-ups for rotation) | `0x8F4003C7404bAf73ba1182C0E9Ad09D993d1aC2a` |

## World ID

App `app_0cc7167efe114ac2e0ef7d9827098353`, RP `rp_3ede5fe1cab9af48` (registered in production and staging). Attester address `0x62377F8ad1151f5b1917708FFD67220F37dF2574` (pin it in the sender app as `VITE_ATTESTER`).

## Verified live

- `ensv2:issue-demo`: `alice.soapay.eth` issued with its own resolver and `addr` unset; the registrant rotated `stealth`, and the new value resolves.
- viem `getEnsResolver` / `getEnsText` / `getEnsAddress` resolve ENSv2 names on Sepolia (`addr` = null).
- Through the API, 3/3 runs: `POST /register` (sponsored ERC-6538 registration) → `POST /names` (ENSv2 subname issued) → the SDK's `resolveStealthMeta` pins the right meta-address. Re-registering a new meta-address through `/register` (the manual rotation path) also works.
- Bug found and fixed: `POST /names` could return `meta_mismatch` right after `/register` because of read-after-write lag on load-balanced public RPCs. It now re-reads at the relay's block for registrations the API itself relayed.

## Not yet run live

- A pay run, scan and spend on Base Sepolia: needs test USDC in the employer wallet (faucet.circle.com). The same flow passes on a Base mainnet fork (`packages/sdk/test/payroll.e2e.test.ts`).
- World ID Selfie Check sessions: need the simulator or a World App.
