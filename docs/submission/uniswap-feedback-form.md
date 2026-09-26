# Uniswap hackathon feedback form: draft answers

Form: https://developers.uniswap.org/hackathon-feedback. Submit **after** the repo is public and `main` contains `FEEDBACK.md`; the prize requires the form to link it.

| Field | Answer |
| --- | --- |
| First name / Last name / Email / Telegram | *(submitter fills in)* |
| Which hackathon? | ETHGlobal Tokyo 2026 |
| Did you complete a project? | Yes |
| What did you build? | Soapay: private payroll on Base. Employers pay employees by ENS name; every payment lands on a fresh ERC-5564 stealth address, so coworkers can't see who earned what. Uniswap lets an employee convert salary *in place*: one EIP-7702 userOp (Permit2 + Universal Router) swaps USDC inside the same stealth address, gas paid in USDC by a paymaster, so nothing gets linked. Uniswap API for routing (quotes requested with a placeholder swapper, so the stealth address isn't exposed); an on-chain Universal Router route on testnet. Live swap on Base Sepolia: https://sepolia.basescan.org/tx/0x2bf66ce2b28b118becdd5aba49d612a444bcffaa006c33b09b92165b5ec55c81. Code: https://github.com/easonchai/soapay. FEEDBACK.md: https://github.com/easonchai/soapay/blob/main/FEEDBACK.md |
| AI-powered or agentic? | Yes: an MCP server lets agents pay, scan, spend and swap by name (agents get their own `*.soapay.eth` identity) |
| Successfully integrated Uniswap? | Yes |
| Time to first successful integration | *(pick the closest option to "under a few hours": the first mainnet quote worked immediately once we had a key)* |
| Biggest blocker | The Trading API returns `UpstreamTimeoutError` for every Base Sepolia quote (3/3 retries), even though v3 pools there have liquidity, so we couldn't use the API for the testnet demo and fell back to QuoterV2 + Universal Router. |
| Rating 1 (docs) | 4: quickstart and OpenAPI spec were accurate; one sentence would clear up the `/swap` body (spread the whole response vs pass `response.quote`) |
| Rating 2 (AI tooling / skills) | 4: the swap-integration skill was right about the `/swap` body when checked live; "chain ids must be strings" is stricter than the API (numbers work) |
| Continue building? | Yes |
| Support that would help | Technical docs, code examples / templates |
| What support was missing? | Testnet routing on Base Sepolia (or a clear "no route on this testnet" error); a documented quote-only mode, or a `recipient` separate from `swapper` on `/swap`, so privacy apps can route without exposing the paying address; a version → router address → calldata-layout table (2.1.x added `minHopPriceX36`). |
| Additional feedback | See FEEDBACK.md (link above), which has line pointers to the integration (`packages/sdk/src/swap.ts`, `spend.ts`, `test/fork.e2e.test.ts`). |
| Yes/No radio at the end | *(submitter decides; probably marketing opt-in)* |
| ToS checkbox | *(submitter accepts)* |
