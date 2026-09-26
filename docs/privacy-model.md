# Privacy model

Who sees what in Soapay, and which privacy properties are guaranteed. Written for judges and the team. The adversary is a **coworker**: someone in the same payroll batch who knows their own line, reads the whole batch on-chain, and probably knows colleagues' main wallets. The **employer is trusted** ([threat model](../CLAUDE.md#agreed-threat-model-overrides-prdmd-where-they-differ)). Decision IDs point to [`decision-log.md`](decision-log.md).

## 1. Who sees what

| Party | Sees | Never sees |
| --- | --- | --- |
| **Employer** (payroll admins, Safe signers) | Everything about the pay run: name → pinned meta-address → stealth address → amount. Afterwards, anything that happens on those stealth addresses (trusted) | Viewing or spending keys; the employee's other income |
| **Employee** | Their own lines (found by scanning with their viewing key) and every public announcement | Which of the other lines belong to which coworker |
| **Coworkers and the chain** | The whole batch: every stealth address and amount, in ascending address order; the employer as payer; later spends, swaps and exits from each address | Which address belongs to whom. Each line has a fresh ephemeral key, so linking needs the viewing key |
| **Soapay API / platform** | Registration relays (a throwaway registrant, the meta-address), ENS subname issuance, World ID rotation proofs. For a Trading API quote: amount, token pair and time, with a random placeholder address (D-27) | **Viewing keys**: it never holds them, and it serves **all announcements unfiltered**, so it can't tell who scans for what. **Stealth addresses in swaps**: the SDK quotes for a placeholder swapper and refuses to send any request that contains the stealth address (`assertNoStealthAddress`); the proxy only forwards `/quote`. Spending keys never leave the client |
| **RPC provider** | Reads from the scanner and the app (balances of your stealth addresses, reads grouped by IP) | Keys. Out of scope for v1 |
| **Bundler** | Each userOp: sender (the stealth address), calls, the 7702 authorization, submitting IP | Keys, or links between userOps beyond IP and timing. Out of scope for v1 |
| **Circle Paymaster** | Each sponsored userOp and its USDC fee (all on-chain anyway) | Anything off-chain |
| **0xbow** (Privacy Pools ASP and relayer) | Exit deposits it screens, and withdrawals it relays to the destination you chose | Which deposit a withdrawal came from (zero-knowledge proof) |
| **Uniswap** | Trading API: the same quote request as our proxy (amount, pair, time, a placeholder swapper), plus our API key and server IP. On-chain: the swap itself, like everyone | The stealth address, from the API. Base Sepolia doesn't use the API at all |

**Residual swap linkage.** The platform and Uniswap see a quote's amount and pair at time *t*, and the swap usually lands on-chain shortly after. A party that watches both could match them. The platform learns nothing a coworker couldn't already see on-chain, and turning off "Use Uniswap Trading API quotes" (or using Base Sepolia) removes the API from the path entirely.

## 2. What's guaranteed and what isn't

| Guaranteed (by construction, tested) | How |
| --- | --- |
| **Cryptographic unlinkability** of lines | A fresh ephemeral key per line (ERC-5564). Without the viewing key a line can't be tied to a meta-address or to another line |
| **Batch structure** reveals no grouping | Lines are strictly ascending by stealth address (enforced on-chain). Multi-tx runs are sorted globally and cut into roughly equal txs, **never per employee** |
| **No gas-funding link** | Spends run as one EIP-7702 userOp with gas paid in USDC by the Circle Paymaster. No ETH ever reaches a stealth address |
| **The consolidation guard** | Before any spend, the guard models the clusters a coworker can see and blocks merges into identifiable wallets (main, coworker-known, exchange) |
| **The compliant exit** | Privacy Pools (0xbow ASP) breaks the link between a stealth address and the wallet you cash out to |
| **The platform never sees stealth addresses in swaps** (D-27) | Placeholder swapper, swap calldata built on the device, SDK guard and tests; proxy limited to `/quote` |

| Not guaranteed | Status |
| --- | --- |
| **Amounts** | Visible on-chain; a coworker who knows a salary can find the line. Mitigated by **default denominations** (one company-wide chunk size, D-31, queued). A shielded rail (Privacy Pools v2) is post-hackathon |
| **Timing** | Spends from different addresses close together in time can be linked. Fix: the client-side **randomized spend queue** (D-28, queued) |
| **Consolidation** | If you choose to merge addresses despite the guard's warning, they are linked |
| **The shared 7702 delegate** | Every spending stealth address delegates to the same `Simple7702Account`, which marks it as "probably Soapay" (accepted) |
| **Employer visibility** | The employer knows name → address → amount and can follow spending after payday. Trusted by design |
| **Infrastructure linkage** | RPC, bundler and IP-level correlation are out of scope for v1 |
