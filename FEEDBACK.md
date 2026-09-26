# Uniswap API feedback

Developer feedback from building one integration: Soapay's "convert salary in place". An employee's pay lands on a fresh stealth address that holds only USDC and no ETH. They want to turn part of it into WETH or ETH **without moving it to another address**, because a transfer would link the two addresses. So the swap must run inside the stealth address itself. That address is an EOA that delegates to `Simple7702Account` (EIP-7702) on first use, and it pays gas in USDC through the Circle Paymaster (ERC-4337 v0.8).

Everything below comes from this build. Where we haven't tried something, we say so.

**How we use the Trading API now (2026-09-26, D-27).** We call **`/quote` only**, with a fresh random **placeholder `swapper`** per quote, never the stealth address. We don't call `/swap`: the SDK re-encodes the quoted V2/V3 route (`quote.route`) as Universal Router 2.1.2 commands whose recipient is the stealth address, then runs the same in-place checks as before. An SDK guard refuses to send any request whose URL or body contains the stealth address, and our key-adding proxy forwards only `/quote`. So neither Uniswap nor our own platform learns which address is swapping. This is the default on Base mainnet; Base Sepolia (where `/quote` times out) quotes on-chain with QuoterV2. Routes we can't rebuild exactly (V4 pools, mixed V2/V3 hops, splits that don't add up) fall back to the on-chain quote. **Verified live:** a real Base mainnet `/quote` through our proxy with a placeholder swapper, re-encoded locally and executed on a Base mainnet fork, for 10 USDC → WETH and 10 USDC → native ETH; both outputs landed at the stealth address above the quoted minimum.

## Where the code is

| What | Where |
| --- | --- |
| Trading API client: placeholder swapper, privacy guard, `/quote`, route re-encoding | [`packages/sdk/src/swap.ts` L577-L840](packages/sdk/src/swap.ts#L577-L840) (re-encoder [L636-L725](packages/sdk/src/swap.ts#L636-L725)) |
| On-chain path (direct V3 exact-in, priced by QuoterV2) | [`swap.ts` L297-L329](packages/sdk/src/swap.ts#L297-L329), [L532-L575](packages/sdk/src/swap.ts#L532-L575) |
| Exact Permit2 allowance as calls, no signature | [`swap.ts` L267-L278](packages/sdk/src/swap.ts#L267-L278) |
| Our own output floor: `BALANCE_CHECK_ERC20` | [`swap.ts` L280-L295](packages/sdk/src/swap.ts#L280-L295), [L521-L530](packages/sdk/src/swap.ts#L521-L530) |
| Router calldata decoder that rejects any recipient except the stealth address (v2/v3/v4 commands) | [`swap.ts` L350-L487](packages/sdk/src/swap.ts#L350-L487) |
| `quoteSwapInPlace` / `swapInPlace` entry points | [`swap.ts` L822-L874](packages/sdk/src/swap.ts#L822-L874) |
| `executeFromStealth`: one 7702 userOp, any calls, gas in USDC | [`packages/sdk/src/spend.ts` L414-L497](packages/sdk/src/spend.ts#L414-L497) |
| Base mainnet fork E2E (real EntryPoint, paymaster, USDC, Permit2, Universal Router; live `/quote` with `SWAP_API_URL`) | [`packages/sdk/test/fork.e2e.test.ts` L157-L240](packages/sdk/test/fork.e2e.test.ts#L157-L240) |
| Trading API request/response tests (mocked HTTP), incl. placeholder swapper and guard | [`packages/sdk/test/swap.test.ts` L136-L391](packages/sdk/test/swap.test.ts#L136-L391) |

## Time to first quote

**We never got a live Trading API quote.** There was no API key in our build environment, so `/quote` returned `401 Unauthorized`. We built the Trading API path from the OpenAPI spec ([`/v1/api.json`](https://trade-api.gateway.uniswap.org/v1/api.json)) and the docs, and tested it only against mocked HTTP responses.

The first swap that actually ran came from the fallback: direct Universal Router calldata priced by QuoterV2 on a Base mainnet fork. That needed no key. So we have no honest "minutes to first quote" number for the API, and the API path still has to be proven against the live service.

**Suggestion:** a keyless, rate-limited quote tier, or a test key usable on Base Sepolia, would let integrators check request shapes before signing up.

## Friction and docs gaps

1. **Uniswap's own sources disagree on the `/swap` body.** The OpenAPI spec's `CreateSwapRequest` requires a `quote` field (a `ClassicQuote`), and the integration guide sends `{ quote: quote }`. Uniswap's `swap-integration` AI skill (v1.6.0) says wrapping the quote in `{quote: ...}` is **wrong** and that the quote response should be spread into the body instead. We followed the spec (we have since stopped calling `/swap`, see the top). **Resolved live, with a key (2026-09-26): both are right, they just describe different objects.** Spreading the *whole* `/quote` response (which carries a top-level `quote` field) returns calldata, and so does `{quote: response.quote}`. Wrapping the whole response as `{quote: response}`, which is what the skill calls wrong, fails with `"quote" does not match any of the allowed types`. One sentence in the docs, "the body needs the `quote` object: spread the response or pass `response.quote`", would remove the apparent contradiction.
2. **Chain ID type.** In the spec, `ChainId` is `type: number` and the guide uses `tokenInChainId: 1`. The same AI skill says these fields "must be strings". We send numbers. **Checked live:** both numbers and strings return 200, so "must be strings" is stricter than the API.
3. **Router version and address.** Per the supported-chains page, Base and Base Sepolia default to Universal Router `2.1.2` (`0xd6145b2D…9c40` / `0x8702463e…2650`), and the header enum is `["2.0","2.1.1","2.1.2"]`. The AI skill hard-codes `x-universal-router-version: 2.0` and lists a different Base router. Since `/swap` returns whichever router the header picks, we pinned `2.1.2` and rejected a `/swap` whose `to` wasn't that router; now we encode for the 2.1.2 router ourselves. A single table of version → address → calldata layout would help; `2.1.x` added a `minHopPriceX36` array to the V3/V2 swap inputs.
4. **API reference pages aren't fetchable by tools.** `developers.uniswap.org/docs/api-reference/*` pages return 303 redirects to `llms.mdx` URLs, and those URLs returned 404 for API-reference pages (guides worked). The OpenAPI JSON was the one source we could rely on.
5. **`generatePermitAsTransaction` says little about the permit transaction.** Its description says "when using a 7702-delegated wallet, set this field to true". It doesn't say what `permitTransaction` contains, whether the allowance it sets is exact or unlimited, or how it interacts with `permitAmount`. We set `permitAmount: "EXACT"`, ignore the returned transaction, and build our own exact-amount approval.
6. **Browser apps need a proxy, and the docs could say so up front.** Uniswap's AI skill warns that the Trading API rejects browser CORS preflights. The recipient app routes calls through our backend anyway, to keep the key out of the bundle; the SDK takes an `apiUrl` for that and then sends no `x-api-key` itself. A proxy means the integrator's server sees every request, which is why ours only ever sees placeholder swappers.
7. **`quote.route` is enough to build the swap, but it isn't documented as a contract.** Pools carry `type` (`v3-pool`, `v2-pool`), `tokenIn`/`tokenOut`, `fee`, and per-split `amountIn`/`amountOut` on the first/last pool. That's all we need to rebuild the swap for a different recipient. A documented, versioned route schema (and V4 pool keys with hooks and tick spacing) would make this safe to rely on; today we only accept V2/V3 and fall back otherwise.

## Smart-account and 7702 recipients

- **We need calls, not a transaction.** `/swap` returns one transaction "from" the swapper. We used to embed it as one call in `Simple7702Account.executeBatch`, between our approvals and our balance check; now we encode that call ourselves from the quoted route, so it never depends on who the API thought the swapper was.
- **`/swap_7702` didn't fit us.** From what we read, it targets Uniswap's own delegate (Calibur), not an account that is already delegated elsewhere. We need "give me calls for an account delegated to X". We noticed the `walletExecutionContext` (CAIP-25) field on `/quote` too late to try it; it might be the intended answer, and an example with it would help.
- **In-place safety is on us.** We decode the Universal Router calldata (now our own) and reject anything that could pay a third party: `TRANSFER`, `PAY_PORTION`, allow-revert flags, Permit2 signature commands, or a v4 `TAKE` to another address. Only then do we sign ([`swap.ts` L350-L487](packages/sdk/src/swap.ts#L350-L487)). A request flag that guarantees "every output goes to `recipient`, no fee portions", echoed back in the response, would let privacy-sensitive integrators do less of this.

## ERC-20 paymasters (gas paid in USDC)

- The stealth address holds no ETH, so the Circle Paymaster collects gas in USDC from the same balance being swapped. The quote's `gasFee` / `gasFeeUSD` assume the swapper pays ETH gas for a plain transaction, so they aren't the number the user actually pays. Our fee comes from the userOp estimate instead, and we check `amountIn + fee <= USDC balance` before signing ([`spend.ts` L453-L480](packages/sdk/src/spend.ts#L453-L480)). So an employee can't swap their whole balance; some USDC has to stay back for gas.
- One run of the fork E2E: swapping 20 USDC to WETH cost about 0.0068 USDC in gas through the paymaster. A plain USDC spend cost about 0.0056 USDC.

## Permit2 and 7702

- Signing a Permit2 message *as* a 7702-delegated EOA sends Permit2's check through ERC-1271 on the delegate, because the address now has code. We skipped signatures altogether. The batch runs `USDC.approve(Permit2, amountIn)`, then `Permit2.approve(USDC, UniversalRouter, amountIn, deadline)`, then the swap, all in one userOp ([`swap.ts` L267-L278](packages/sdk/src/swap.ts#L267-L278)). On the fork, both allowances are back to 0 after the swap ([`fork.e2e.test.ts` L183-L186](packages/sdk/test/fork.e2e.test.ts#L183-L186)). The cost is two extra calls per swap, which a batching account barely notices.
- A related result from the same fork run, not a Uniswap one: Base USDC's own `permit`, used by the paymaster, **did** validate via ERC-1271 on `Simple7702Account`.
- The "proxy approval" contract used by the no-Permit2 flow wasn't deployed on Base Sepolia when we checked, so that flow isn't an option on testnet for us.

## Testnet support

Base Sepolia (84532) is in the API's `ChainId` enum, and the supported-chains page lists Universal Router 2.1.2 there. We checked with `eth_getCode` that the router, Permit2 and QuoterV2 addresses we use have code there. **Update (2026-09-26):** a live swap-in-place ran on Base Sepolia through the on-chain fallback (see "Live testing with an API key" below); the Trading API itself doesn't route there.

## What worked well

- **The Universal Router composes cleanly inside a smart-account batch.** Exact Permit2 allowance, then `execute(swap)`, then `execute(BALANCE_CHECK_ERC20)` gave us a floor that holds on-chain no matter what the quote said. On the fork, 20 USDC swapped to WETH inside the stealth address, and every WETH `Transfer` ended at that address. 10 USDC to native ETH worked through `UNWRAP_WETH` to the stealth address, with no WETH left behind. Both tests are in [`fork.e2e.test.ts` L157-L213](packages/sdk/test/fork.e2e.test.ts#L157-L213).
- **The OpenAPI spec is complete and precise.** Enums for protocols, `permitAmount`, router versions and chain IDs were enough to write the client. `protocols: ["V2","V3","V4"]` cleanly keeps UniswapX orders out, since they can't be batched calls.
- **The `x-agent-info` header is well scoped.** It's analytics only, explicitly never carries addresses or keys, and never changes the response. That makes it safe to send from a privacy product.
- Permit2 and WETH live at the same addresses on Base and Base Sepolia, so our address table is small.

## Live testing with an API key (2026-09-26)

- **Base Sepolia (84532) `/quote` fails every time with `UpstreamTimeoutError`** ("A routing dependency timed out or failed; the request may succeed on retry"). 3 of 3 retries failed, for USDC→WETH, while Base mainnet `/quote` with the same key and body succeeded right away. The chain is listed as supported, and v3 pools on Base Sepolia do have liquidity (QuoterV2 `quoteExactInputSingle` returns quotes at the 0.01%, 0.05%, 0.3% and 1% fee tiers). A clear "no route on this testnet" error, or working testnet routing, would save integrators a lot of time. We fell back to on-chain QuoterV2 + Universal Router for the testnet demo.
- **The quote works with a placeholder `swapper`**, which matters for privacy apps: you can route without revealing the paying address to the quoting service. **We now rely on this by default** (see the top): a random swapper per quote, then our own encoding of `quote.route`. The live mainnet quotes had the same shape as with a real swapper (`output.recipient` and `aggregatedOutputs` simply echo the placeholder). A documented "quote-only, no swapper" mode, or a `/swap` that takes an explicit `recipient` without the payer, would make privacy-preserving integrations first-class instead of a workaround.
- **Cost of the workaround:** we can't use V4 routes (we'd need pool keys we don't get in a stable form), and the quote's gas numbers describe Uniswap's calldata, not ours.

