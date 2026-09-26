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
| **Pay token: Soapay mock USDC** (D-52) | [`0x028D969c20b740582428f5043954c380686214Bb`](https://sepolia.basescan.org/address/0x028D969c20b740582428f5043954c380686214Bb) ("USD Coin (Soapay test)", USDC, 6 decimals, EIP-2612) |
| Circle USDC (exit and Circle-paymaster testing only) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Bundler (public, keyless) | `https://public.pimlico.io/v2/84532/rpc` (EntryPoint v0.8 supported) |
| Gas sponsorship | Pimlico sponsorship paymaster, reached only through the API's `POST /paymaster` (key `PIMLICO_API_KEY`, server-side). Paymaster seen on-chain: `0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402` |

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

## Mock USDC, sponsored gas and the welcome drop (D-52, 2026-09-26)

Judges can try everything without Circle's faucet. On Base Sepolia the pay token is our own mock USDC, stealth spends are gas-sponsored, and every wallet that opens the company app gets test funds once. Base mainnet is unchanged (Circle USDC, Circle paymaster).

**MockUSDC** (`contracts/src/MockUSDC.sol`, OpenZeppelin ERC20 + ERC20Permit + AccessControl, nothing else; it holds no funds). Deployed by `contracts/script/DeployMockUSDC.s.sol` from the deployer:

| What | Value |
| --- | --- |
| Token | [`0x028D969c20b740582428f5043954c380686214Bb`](https://sepolia.basescan.org/address/0x028D969c20b740582428f5043954c380686214Bb), deploy tx [0x8d8b899a…0c9c](https://sepolia.basescan.org/tx/0x8d8b899af10d7ff24753ac43954926400d128ca5d50496dd6e4e8e9d98df0c9c) (block 47319468) |
| Admin (`DEFAULT_ADMIN_ROLE`) | the deployer `0x7757A7C9f4eD02a02353A7929cfb399e9286f52c` |
| Minter (`MINTER_ROLE`) | the API relayer `0x509aD63D73f41FA9DD7162F7FcD3876090C8157F` (derived from `RELAYER_PRIVATE_KEY`) |
| Source verification | Blockscout: verified ([base-sepolia.blockscout.com](https://base-sepolia.blockscout.com/address/0x028D969c20b740582428f5043954c380686214Bb)). Basescan: not verified (no `BASESCAN_API_KEY` in the env) |

**Sponsored gas:** stealth spends (recipient app, MCP) and smart-wallet employers' EIP-5792 batches (`paymasterService` capability) go through `POST /paymaster`, which forwards ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData` (and `pm_sponsorUserOperation`) to `https://api.pimlico.io/v2/84532/rpc`. It sponsors only chain 84532, EntryPoint v0.8 (and v0.6/v0.7 for smart wallets), execute/executeBatch calls whose targets are the mock token, Permit2, the Universal Router, StealthDisperse or the Announcer, with no ETH value. No rate limits (mock token, testnet). Without `PIMLICO_API_KEY` it answers 503 `sponsorship_disabled` and the apps say so.

**Welcome drop:** `POST /faucet {address}` mints 1,000,000 mock USDC once per address (sqlite `faucet_claims`); no other limits. An ETH drip is implemented but **off by default** (`FAUCET_ETH_WEI=0`, owner decision pending; when on, it tops a wallet up to that amount and stops while the relayer holds under `FAUCET_MIN_RELAYER_ETH_WEI`, 0.02 ETH). Plain-EOA employers (MetaMask) still need a little Base Sepolia ETH for the approve + pay txs.

**Verified live (2026-09-26, local API from this branch against Base Sepolia):**

| Step | Tx |
| --- | --- |
| Welcome drop: 1,000,000 mock USDC to a fresh EOA | [0x1f1e447a…0416](https://sepolia.basescan.org/tx/0x1f1e447acda276a4eca529c4bb92fb21b8f0880d54e583e3abec4bc8f2a20416) (a second call answered `already_claimed`) |
| Sponsored spend from that EOA (7702 authorization in the userOp, 0 ETH, no fee taken) | [0x15ea6dcd…265c](https://sepolia.basescan.org/tx/0x15ea6dcd7f489ff829365c6e9dfef0b86859aba4cdc97e0a010fa761e418265c) |
| Second sponsored spend (already delegated) | [0x1c10b505…2d8f](https://sepolia.basescan.org/tx/0x1c10b505c4d5e43306e1c518ffa8e7ba407391dfeed0539d472d614aed452d8f) |
| `scripts/fund-usdc.sh`: 1,000,000 mock USDC to the deployer (the CLI/MCP payer) | [0xe085c3e5…7fd6](https://sepolia.basescan.org/tx/0xe085c3e597b082b5878595f9d414798999de9f86fae3e357728d8ff5a8ef7fd6) |

### Uniswap v3 pool (created, then out of scope)

Created before the owner dropped the Uniswap bounty (D-53); nothing in the product depends on it, but the SDK's on-chain swap path (QuoterV2 + Universal Router, fee tier 500) finds it (10 mock USDC quoted to 0.00312 WETH). `contracts/script/SetupMockPool.s.sol`, from the deployer:

| What | Value |
| --- | --- |
| Pool mock USDC / WETH, 0.05% | [`0x820537A74A4ECf64882c8049Dde2FAabE1920b14`](https://sepolia.basescan.org/address/0x820537A74A4ECf64882c8049Dde2FAabE1920b14), initialised at 3000 USDC per ETH |
| Liquidity | full range, 150 mock USDC + 0.05 WETH, position NFT #82411 (NonfungiblePositionManager `0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2`, owner the deployer) |
| Txs | grant minter [0x1150a475…95f8](https://sepolia.basescan.org/tx/0x1150a47574c03c9027777aac4ce1f2546e2e5e0e1a498146d1978aad827895f8), mint 150 [0xa376074d…0f0a](https://sepolia.basescan.org/tx/0xa376074d36e787dbe27c9a800104e20ae33af202933c8b31e0259a30f4e2af0a), revoke [0xffc879d3…8260](https://sepolia.basescan.org/tx/0xffc879d30cc5cbbb4122531a5b51ba1bed4ca738168e86fcb3d9c6e3c4578260), wrap [0xbb6e7180…c9ee](https://sepolia.basescan.org/tx/0xbb6e718064468c3b9c1cce1ebe522a4f3828e46899c6efd648ad0255e7dfc9ee), approvals [0x6223af70…c78f](https://sepolia.basescan.org/tx/0x6223af708231523008c73c0be699798d55d159c3601397eca2b6a8423102c78f) / [0x52f74181…99ac](https://sepolia.basescan.org/tx/0x52f74181ded19a50115a346db405e714d8245db9834763ae1675561dc6e199ac), create + initialise [0xd621f166…2e19](https://sepolia.basescan.org/tx/0xd621f166ef3d998958863e56b1161d78d608fc10ae7a24204bb2b76d4ad02e19), add liquidity [0x858ad14a…2593](https://sepolia.basescan.org/tx/0x858ad14ae9d5914ceb9658c52a177ae9c2d6d42d1831764e8caf4a19aa672593) |

No live swap was run (scope dropped).

**Top up (mock USDC):** `scripts/fund-usdc.sh [address] [--amount N] [--via mint|api]`. Default: mint 1,000,000 mock USDC with the relayer's `MINTER_ROLE` (else the deployer grants itself the role for one mint and revokes it). `--via api` uses the welcome drop instead.

## Funding with Circle USDC (mainnet-like testing, D-47; no longer needed for the demo)

Only for the exit or the Circle-paymaster path: override the pay token back to Circle USDC (`VITE_PAY_TOKEN` / `PAY_TOKEN` = `0x036CbD53842c5426634e7929541eC2318f3dCF7e`) and fund with `scripts/fund-usdc.sh --token circle`.

Test USDC is scarce: Circle's faucet gives **20 USDC per address per chain every 2 hours**. The apps default to testnet-sized amounts on Base Sepolia (D-47): 5 USDC chunks, small example salaries, and a confirmation on any pay run above 50 USDC. The one thing that can't shrink is the exit: a leg needs **≈ 16.40 USDC on one stealth address** (below), so fund that line on its own (denominated payouts off for that run, or a chunk above 16.40).

**Top up:** `scripts/fund-usdc.sh [address] --token circle`

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

Route: Base Sepolia stealth address → CCTP V2 burn with the Forwarding Service → minted back to the **same** stealth address on Ethereum Sepolia → 0xbow USDC pool deposit (`0x0b062Fe3…4C0f`, Entrypoint `0x34A20681…21cB`) → ASP approval → withdrawal to a fresh destination, relayed or (D-48) sent directly by the destination. The stealth address never holds ETH; a direct withdrawal needs a little Sepolia ETH on the destination.

**Status (2026-09-26): run once with 18 USDC: bridged (16.12 USDC minted), deposited and approved; the withdrawal is pending. The relayer's fixed ≈ 21.5 USDC fee exceeds the ≈ 9.95 USDC in the pool, so it goes out directly once the destination holds Sepolia ETH. The funding table below predates the run.**

- The smallest exit leg (D-48, `exitLegMinimum`) is **≈ 18.6 USDC** with a direct withdrawal (10 USDC pool minimum + ≈ 2.21 forward fee + ≈ 0.002 CCTP fee + ≈ 6.38 USDC Sepolia paymaster prefund + ≈ 0.06 Base Sepolia prefund, the prefunds with 10% headroom; the unused prefund is refunded to the address) and **≈ 81.3 USDC** through the relayer (it charges a fixed ≈ 21.5 USDC per withdrawal, and the pool refuses a relayer fee above 30% of it, so the withdrawal must be ≥ ≈ 72 USDC). The 2026-09-26 run paid 18 USDC: bridged to 16.12, deposited, approved; its withdrawal goes out directly (`EXIT_WITHDRAW=direct`, the destination needs a little Sepolia ETH).
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

**Completed 2026-09-26.** The testnet relayer's fixed ~21.5 USDC fee exceeded the 9.95 USDC in the pool, so the leg withdrew directly (D-48).

| Step | Tx |
| --- | --- |
| Pay run (Base Sepolia), 18 USDC to one fresh stealth address | [0xbd9d…799b](https://sepolia.basescan.org/tx/0xbd9d0001b4fe5fbee969003921b43a82608e7e3d0748a3fcd347f33244a3799b) |
| CCTP burn (Base Sepolia), gas in USDC | [0x78fa…6c89](https://sepolia.basescan.org/tx/0x78fa2c713458f30879096a4d79a024f4fc0eab55aceffc8789111beaf19b6c89) |
| Forwarded mint to the same address (Ethereum Sepolia), 16.12 USDC | [0x5fee…36ab](https://sepolia.etherscan.io/tx/0x5feec0c529b0b424b98c3b4c28f00191d20e7ca25b52b5d8d41627e7779436ab) |
| Pool deposit (Ethereum Sepolia), 10.05 USDC (value 9.95 after the pool fee) | [0xa7c6…13e0](https://sepolia.etherscan.io/tx/0xa7c6ff5f59c0c231b53df82859fca712798d398e9a907aefba778a5495d013e0) |
| ASP approval | approved |
| **Direct** withdrawal (Ethereum Sepolia) to a fresh wallet funded only from a public faucet: 9.95 USDC arrived | [0xed92…c672](https://sepolia.etherscan.io/tx/0xed9235c87f7643bde048cd9e29c8abebe989a64016a628c85faa7ed5724fc672) |

## Recovery beat: stolen phrase vs pin check (World ID account recovery)

**Run 2026-09-26** with `pnpm demo:recovery-check sam-demo` (D-55): 10/10 checks passed against the live API (`https://soapay.up.railway.app/api`, pinned attester `0x6237…2574`).

- `sam-demo.soapay.eth`: registrant `0x897BeA8D61cc3C4c4F915ef4C73F31089242b2C8`, resolver `0xF8A169c2b178A3B36A695F93cf2de4F85950Ca3D`, claimed by `pnpm demo:setup-recovery` (ERC-6538 [0xb807…8065](https://sepolia.basescan.org/tx/0xb8072c287cdb65139f607e8d0e8260fa60a6ae7e773d5838dbe0bc7bf9268065), name [0xffd3…c29d](https://sepolia.etherscan.io/tx/0xffd310b3bb82b1d6ce39a216e73f1e8a96bfac99966c99f36f2fb0df67b7c29d)). The first claim attempt got a bare proxy 502 while the name was issued on-chain but not stored by the API; the `soapay.eth` owner unregistered it ([0x3e9a…c52e](https://sepolia.etherscan.io/tx/0x3e9ae13fdcf6881eff9428f99bd4a3736191c210e455aa54e8ff3cc1e210c52e)) and the claim was re-run. `examples/demo/claim.ts` now waits for the row after a bare 5xx.

| Step | Result | Tx |
| --- | --- | --- |
| Pin (SDK `checkMetaPin`, then `soapay distribute` dry run) | `new` → `ok`; CLI exit 0 | — |
| Gas top-up to the stolen registrant (Sepolia, from the `soapay.eth` owner) | | [0x1eb7…dce5](https://sepolia.etherscan.io/tx/0x1eb79e84d2c965db30bd2e35ea95811740b32abddefc3bdfb877cab6af40dce5) |
| **Attack:** ENS `setText(stealth)` → attacker meta, from the stolen registrant key | success | [0xc156…7646](https://sepolia.etherscan.io/tx/0xc1566a093999556cfa5e8624a51397d0d80ff9b209608e276232cbc99e577646) |
| **Attack:** ERC-6538 `registerKeys` → attacker meta (Base Sepolia) | success | [0x14e2…dac2](https://sepolia.basescan.org/tx/0x14e212ca212570e4c61b7a7b3f80eef31580e1207bde6416563d1ac34e92dac2) |
| `POST /names/sam-demo/rotation` (valid RotationClaim, no World ID proof) | **409 `no_session`** (renamed `no_worldid_link` in D-58), no attestation | — |
| Re-check | SDK **`blocked`**, attestation `missing` ("No World ID re-verification on record for this change"); CLI **exit 3** (ALERT, nothing sent) | — |
| **Restore:** ENS `setText(stealth)` → victim meta | success | [0x43be…3431](https://sepolia.etherscan.io/tx/0x43be4fadc4f44ddc4006413c079e5d4640a56f7057646170790c30dc35593431) |
| **Restore:** ERC-6538 `registerKeys` → victim meta | success | [0x373f…dc0d](https://sepolia.basescan.org/tx/0x373f79fe194e321ffbe906b9ea97af84d85447a63faedec997c27388113bdc0d) |
| Re-check after restore | SDK `ok`; CLI exit 0 | — |

Earlier runs the same day (same outcome) also rewrote and restored the record: attack [0x0a33…64be](https://sepolia.etherscan.io/tx/0x0a336568103d6ad9772b45aa307a1e6af03dbbebc78047ff21a6f1c8c81d64be) / [0xe666…90a4](https://sepolia.basescan.org/tx/0xe6665cc98ccd09399d4baae8d9a2fc0f537fe3c5b71eb159cf98be74dd3290a4), restore [0x8e7a…2f3d](https://sepolia.etherscan.io/tx/0x8e7ac0b41839c844406f381f71b154a81f3f9626dd2025292f760b802f252f3d) / [0xd4bc…c45b](https://sepolia.basescan.org/tx/0xd4bcc13c455f6fcb9b2575dcce7ba7428be9484641bf85657a8dcdfaf326c45b); attack [0xd184…bbaa](https://sepolia.etherscan.io/tx/0xd1845f5e6eb2900ead79eae6db999e2e466825a1c07a61c1bd1c40338f38bbaa) / [0x4122…4f33](https://sepolia.basescan.org/tx/0x4122d8ca3439bb9fcd239c5c50188612931413f056e0466b407d5ce0a57a4f33), restore [0x7af9…05e6](https://sepolia.etherscan.io/tx/0x7af9173297d7acc1a7655a4471f90d36d378d97601941bcb3be43f92546105e6) / [0x9c57…bebe](https://sepolia.basescan.org/tx/0x9c573798510ec8a69c57d169dff859f7113c514def473482726cf8fae920bebe).

Not verified here: the company app's UI pill (it runs the same SDK `checkMetaPin` and attestation lookup, but no browser was driven) and the accepted path (alex-demo rotating with a real World App).

## Not yet run live

- A full pay run → scan → sponsored spend through the apps with the mock token (the pieces ran live separately: the welcome drop and two sponsored spends above; StealthDisperse is token-agnostic and its mock-token permit path is covered by `contracts/test/MockUSDC.t.sol`). The deployer now holds 1,000,000 mock USDC for it.
- A smart-wallet (Coinbase Smart Wallet) EIP-5792 batch with the `paymasterService` capability: the proxy accepts its EntryPoint v0.6 userOps in tests, not yet with a real wallet.
- World ID Selfie Check sessions: need the simulator or a World App.
