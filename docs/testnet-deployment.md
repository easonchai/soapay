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

- Headless, 2026-09-26 (`scripts/demo-pluggable.sh`, D-43): `soapay distribute --preset dividend --execute` paid ENSv2 names, a raw meta-address and an AI agent in one StealthDisperse tx ([0xf7fb06df…](https://sepolia.basescan.org/tx/0xf7fb06dfa47313fbeab80fe6e01cc0d003d38d221819ad35d09bfcad9051ce0e), 12 lines; earlier runs [0xd085a6be…](https://sepolia.basescan.org/tx/0xd085a6becb6e0c59126fb554d4efa2b400cdd1a4dc7fb379eaa80fc194123807), [0xc055c27c…](https://sepolia.basescan.org/tx/0xc055c27c09e9b25f50c4b48bab4798b833738947c6e3a0c8cdf21ffeb79221f8)); `soapay scan` found a holder's lines with real balances. Through the MCP server over stdio, `invoice-agent.soapay.eth` was claimed with ENSIP-26 records (Sepolia tx 0x4b11d380…e255), paid, scanned, and spent 0.02 USDC gaslessly ([0x35172021…](https://sepolia.basescan.org/tx/0x3517202141e4f1ad9849aa40f04ec3d7e332bd8d38a72d991d64d1e4b4d3f3e2)). Demo names `dividend-ana|ben|cleo.soapay.eth` were claimed through the API relayer.

## Funding (test USDC)

Test USDC is scarce: Circle's faucet gives **20 USDC per address per chain every 2 hours**. The apps default to testnet-sized amounts on Base Sepolia (D-47): 5 USDC chunks, small example salaries, and a confirmation on any pay run above 50 USDC. The one thing that can't shrink is the exit: a leg needs **≈ 16.40 USDC on one stealth address** (below), so fund that line on its own (denominated payouts off for that run, or a chunk above 16.40).

**Top up:** `scripts/fund-usdc.sh [address] [--chain base-sepolia]`

- No address = the deployer, derived from `DEPLOYER_PRIVATE_KEY` in `contracts/.env` (only the address is printed).
- With `CIRCLE_API_KEY` (environment, else `contracts/.env`; see `contracts/.env.example`) it calls Circle's faucet API (`POST https://api.circle.com/v1/faucet/drips`, `{"address", "blockchain": "BASE-SEPOLIA", "usdc": true}`, 204 on success) and prints success, the rate-limit message (retry after 2 hours), a rejected key, or the account-verification refusal. Circle's API faucet only works for a Circle account that **completed verification**, even for testnet tokens; the key is a testnet API key from the Circle Developer Console.
- Without a key it prints the manual link: [faucet.circle.com](https://faucet.circle.com), network Base Sepolia, the address.
- It always prints the address's Base Sepolia USDC balance before and after (`cast call` on `https://sepolia.base.org`, or `RPC_URL`). The key reaches curl through a private temp file, never the command line.

**More than 20 USDC, legitimately:**

- **Other chains' faucets, bridged over CCTP.** Each chain on faucet.circle.com (Ethereum Sepolia, Arbitrum Sepolia, OP Sepolia, …) has its own 20 USDC limit per address. Bridge to Base Sepolia with CCTP (burn on the source, mint on Base Sepolia). This needs gas (test ETH) on the source chain.
- **Ask Circle at the event.** Ask Circle's team at their booth whether they can top up a demo wallet.
- **Recycle.** The demo moves funds only between addresses we control: recipients spend back to a wallet we hold, and the exit withdraws to a destination we choose. Send it back to the employer wallet after each rehearsal.

Don't rotate many fresh addresses through the faucet to get around the per-address limit.

## Live exit (Privacy Pools v1 via CCTP V2)

Route: Base Sepolia stealth address → CCTP V2 burn with the Forwarding Service → minted back to the **same** stealth address on Ethereum Sepolia → 0xbow USDC pool deposit (`0x0b062Fe3…4C0f`, Entrypoint `0x34A20681…21cB`) → ASP approval → relayed withdrawal to a fresh destination. The stealth address and the destination never hold ETH.

**Status (2026-09-26): not run yet, blocked on test USDC. Nothing was spent.**

- The smallest exit leg is **≈ 16.40 USDC** on one stealth address (`exitLegMinimum`: 10 USDC pool minimum + ≈ 2.21 forward fee + ≈ 0.002 CCTP fee + ≈ 4.13 USDC Sepolia paymaster prefund + ≈ 0.06 Base Sepolia prefund, the prefunds with 10% headroom; the unused prefund is refunded to the address). The run pays **18 USDC** for margin.
- Wallets we control (addresses derived from the git-ignored env files; balances read 2026-09-26):

| Wallet | Address | Base Sepolia USDC | Base Sepolia ETH | Sepolia ETH |
| --- | --- | --- | --- | --- |
| Deployer (`contracts/.env`, also the MCP agent payer) | `0x7757A7C9f4eD02a02353A7929cfb399e9286f52c` | **11.85** (re-read 2026-09-26 by `scripts/fund-usdc.sh`) | 0.40 | 0 |
| ERC-6538 relayer | `0x509aD63D73f41FA9DD7162F7FcD3876090C8157F` | 0 | 0.10 | 0 |
| `soapay.eth` owner | `0xC33FcD38117b76CC05dab2F3DD2d9B71111358dB` | 0 | 0 | 0.26 |
| Issuer | `0x20E69b1fdEB0C945CE8FE758CF3B3B4BBfC0068b` | 0 | 0 | 0.11 |
| L1 relayer | `0x8F4003C7404bAf73ba1182C0E9Ad09D993d1aC2a` | 0 | 0 | 0.12 |
| Attester | `0x62377F8ad1151f5b1917708FFD67220F37dF2574` | 0 | 0 | 0 |

- **Funding needed:** at least **6.15 USDC more on Base Sepolia to the deployer `0x7757A7C9f4eD02a02353A7929cfb399e9286f52c`** (11.85 → 18). One faucet request (`scripts/fund-usdc.sh`, or [faucet.circle.com](https://faucet.circle.com), Base Sepolia, 20 USDC) covers it. Its 0.40 ETH covers the approve + pay txs. Nothing is needed on Ethereum Sepolia: Circle's forwarder mints, the Circle paymaster takes gas in USDC, and the 0xbow relayer pays the withdrawal.
- **Run it** (resumable; state incl. the throwaway recipient mnemonic in the git-ignored `packages/sdk/.exit-live.json`; keys are never printed):

```sh
cd packages/sdk
set -a; source ../../contracts/.env; set +a
EXIT_LIVE=1 EMPLOYER_KEY=$DEPLOYER_PRIVATE_KEY PAY_AMOUNT=18000000 EXIT_LIVE_MINUTES=45 \
  pnpm exec vitest run test/exit.live.test.ts --disable-console-intercept
```

  It pays one fresh stealth address through StealthDisperse, scans for it, then drives the leg (burn → attestation → forwarded mint → deposit → ASP → withdrawal) and prints each tx's explorer link. If the ASP hasn't approved within `EXIT_LIVE_MINUTES`, **re-run the same command** later: it resumes from the state file and finishes the withdrawal. Record the printed links in the table below.

| Step | Tx |
| --- | --- |
| Pay run (Base Sepolia) | pending funding |
| CCTP burn (Base Sepolia) | pending |
| Forwarded mint (Ethereum Sepolia) | pending |
| Pool deposit (Ethereum Sepolia) | pending |
| ASP approval | pending |
| Relayed withdrawal (Ethereum Sepolia) | pending |

## Not yet run live

- A pay run, scan and spend on Base Sepolia: needs test USDC in the employer wallet (`scripts/fund-usdc.sh`, see "Funding"). The same flow passes on a Base mainnet fork (`packages/sdk/test/payroll.e2e.test.ts`).
- World ID Selfie Check sessions: need the simulator or a World App.
