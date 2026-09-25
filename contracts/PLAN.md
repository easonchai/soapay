# StealthDisperse: plan

## Goal
One transaction per pay run that pays N ERC-5564 stealth addresses on Base and announces each one, so every recipient's scanner finds its line and no coworker in the batch can tell which line belongs to whom (beyond what amounts reveal).

Threat model (agreed, overrides PRD): the only adversary is a coworker in the same batch. The employer is trusted. ENS is only a reference identifier; the sender app pins each recipient's ERC-6538 meta-address at enrollment and derives fresh stealth addresses client-side every run. Gateway mode, Privacy Pools and chain-analyst threats are out of scope.

## Contract spec: `src/StealthDisperse.sol`
- `pay(IERC20 token, Payment[] payments)`: for each line, `safeTransferFrom(msg.sender, stealthAddress, amount)`, then `ANNOUNCER.announce(1, stealthAddress, ephemeralPubKey, metadata)`.
- `payWithPermit(token, payments, value, deadline, v, r, s)`: best-effort EIP-2612 permit (try/catch, so a front-run permit cannot block the payment). If the allowance is still below the batch total afterwards it reverts `PermitFailed()`, then calls `pay`. This path is for plain EOAs only: on Base USDC, a permit for a 7702-delegated or smart-account owner goes through ERC-1271 and usually fails. Those accounts approve and pay in one EIP-5792 atomic batch instead.
- `Payment = {address stealthAddress; uint256 amount; bytes ephemeralPubKey; bytes1 viewTag}`.
- Rejects: `NotAscending(i)` (addresses must be strictly ascending, which rules out duplicates and address(0)), `ZeroAmount(i)`, `BadEphemeralKey(i)` (length is not 33 or the prefix is not 0x02/0x03), `PermitFailed()`.
- The ascending rule guards against bugs in the employer's own app and dedupes lines within a batch. It is not a privacy guarantee on its own; see the client invariants.
- Metadata (77 bytes): the 57 standard EIP-5564 bytes `viewTag(1) | 0xa9059cbb transfer selector(4) | token(20) | amount(32)`, then `payer(20)` = `msg.sender`. `Announcement.caller` is always this contract, so the payer suffix is what lets scanners drop spam: anyone can call `pay` with a fake token.
- **Scanners MUST** recompute the stealth address from `ephemeralPubKey`, read the actual token balance, and never trust the token or amount in the metadata. The payer field is only a filter hint.
- No state, no owner, no funds held, no upgradeability. Validation and metadata live in `_validate` and `_metadata` so rule changes stay local.

## Verified against canonical sources
- The ERC5564Announcer is at `0x55649E01B5Df198D18D95b5cc5051630cfD45564` on Base (ScopeLift README). The runtime bytecode was read from Base mainnet and is used verbatim in the tests via `vm.etch`. The fork test asserts it still matches.
- ABI: `announce(uint256,address,bytes,bytes)`. Event: `Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)`. `caller` is `msg.sender` of `announce`, which is this contract, not the employer.
- EIP-5564 token metadata: byte 1 view tag, bytes 2-5 function selector, bytes 6-25 token, bytes 26-57 amount. The design matches this.
- Scheme 1 ephemeral key: the ScopeLift SDK emits 33-byte compressed keys, so the length check is correct.
- Base USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (symbol USDC, 6 decimals, FiatToken v2, checked on-chain).

## Deviations from the starting design
1. Added a 0x02/0x03 prefix check on the ephemeral key. It is cheap and rejects uncompressed or garbage keys. An invalid key means the recipient's scanner never finds the payment. It does not check that the key is on the curve; that stays client-side.
2. The selector is kept as `transfer` but named as the constant `METADATA_SELECTOR`. The actual call is `transferFrom`, but `0x23b872dd` is shared with ERC-721, so a scanner could not tell whether bytes 26-57 hold an amount or a token id.
3. `ZeroAmount` is checked before the key check. This only changes which error wins when a line has several faults.
4. The interface declares the `Announcement` event so tests can use `vm.expectEmit`. The call ABI is unchanged.
5. Review H1: `payWithPermit` checks the allowance after the permit and reverts `PermitFailed` instead of failing silently.
6. Review M1: the payer suffix is added to the metadata (77 bytes).

## Invariants
- The contract's token balance is always 0. Every line moves exactly `amount` from `msg.sender` to `stealthAddress`.
- Funds are only ever pulled from `msg.sender`. The permit signer is `msg.sender`, so a third party cannot use an employer's allowance or signature.
- Each successful line produces exactly one Transfer and one Announcement, in the same order. Any failure reverts the whole batch.
- On-chain line order is a function of the stealth addresses alone. That removes one class of employer-app bug; it is not a privacy guarantee by itself.

## Client invariants (sender app; the contract cannot enforce these)
- **Multi-tx runs:** derive every line for the whole run, sort globally by stealth address, then cut into roughly equal txs. Never partition by employee; per-tx totals would reveal salaries (review H2).
- **Batch cap:** at most 350 lines per tx. All-in cost is about 42k gas per line, so the 2^24 EIP-7825 cap fits about 398 lines with zero margin (review M3).
- **No ephemeral key reuse:** check that no ephemeral key repeats across lines. A repeat means an RNG bug (review M4).
- **Safe employers:** use `MultiSendCallOnly` with operation=0 (never `MultiSend`), and approve exactly the total (review L3).

## Recommended payment paths (for the team to confirm; not yet decided)
- The contract is a USDC blacklist chokepoint: if Circle blacklists it, every employer on this path stops (review M2/S1). Recommendation:
  - Smart-account, 7702 and Safe employers use a contract-less EIP-5792 atomic batch of `[USDC.transfer(stealth, amt), Announcer.announce(...)] × N`. There `caller` is the employer and no allowance is needed.
  - StealthDisperse is the path for plain EOAs.
- StealthDisperse is immutable and stateless, so moving to a redeployed address is only a config change in the sender app.

## Test matrix (`forge test -vv`)
| Area | Tests |
| --- | --- |
| Announcements | one exact `Announcement` per line (`expectEmit` against the real bytecode); raw-log decode of metadata byte offsets; SDK-derived vectors |
| Validation | out of order, duplicate, address(0), zero amount, key length 0/32/65, prefix 0x04, empty batch is a no-op |
| Atomicity | insufficient balance on the last line and a false-returning token both revert the whole batch with no partial transfers; a token with no code reverts |
| Auth | a coworker cannot spend the employer's allowance; a coworker paying with their own funds does not touch the employer; a coworker replaying the employer's permit fails |
| Permit | happy path; a front-run permit still pays; an existing allowance plus a junk permit still pays; a bad signature, a permit below the total, or a coworker replay reverts `PermitFailed`; fork: a 7702-delegated owner's ECDSA permit on real USDC reverts `PermitFailed` |
| Fuzz | batch size 1-64 with random amounts (sum, log count, metadata); an adjacent swap always reverts at the right index |
| Gas | 10/100/300 lines (`GasTest`) |
| Fork | real Base USDC and the real Announcer (`BASE_RPC_URL=... forge test --match-contract Fork -vv`, skipped otherwise) |

Gas per line, measured with the 77-byte metadata (tx gas including 21k and calldata, mock ERC20): 10 lines → 40.6k, 100 → 37.2k, 300 → 37.3k. Real Base USDC execution alone is about 38k per line, plus about 1.8k of calldata at roughly 256 B/line. The client plans with the reviewer's all-in figure of about 42k per line, which gives the 350-line cap.

## Deploy
1. `forge test` (and the fork test with `BASE_RPC_URL`).
2. `forge script script/Deploy.s.sol --rpc-url base --account <keystore> --broadcast --verify` (needs `BASE_RPC_URL`, `BASESCAN_API_KEY`). This is a CREATE2 deploy through the standard 0x4e59…956C deployer with salt `keccak256("soapay.StealthDisperse.v1")` (override with `SALT`). The script refuses to deploy if the Announcer is missing and is idempotent if the contract is already deployed.
3. Record the address in the sender app. Run one 1-line USDC pay and confirm the recipient app finds it.

## Tools
`tools/derive.ts` (ScopeLift SDK): `pnpm derive st:eth:0x…=<amount> …` prints sorted Payment lines and a `cast` tuple. `--demo N` generates recipients and self-checks that each one can scan and spend its line.

## Open questions
1. **Amounts are the main remaining leak under this threat model.** A coworker who knows or guesses a colleague's salary finds their line directly. The contract already allows several lines per person (split into denominations, each to a fresh stealth address). Should the sender app do that by default?
2. Metadata selector: keep `transfer` (unambiguous for scanners) or use `transferFrom` (literal)? Check what the recipient scanner expects.
3. Should scanners require a known payer (from the metadata suffix) by default, or only rank by it?
4. Fee-on-transfer or rebasing tokens would make metadata amounts wrong. Should the app restrict tokens to USDC, or should the contract enforce an allowlist?
5. Calldata is 256 B/line, and the L1 data fee dominates on Base. Pack the key as `bytes1 prefix + bytes32 x`, or pass the view tag and prefix in one word, if cost matters.
6. Confirm the recommended payment paths above (EIP-5792 batch for smart accounts, StealthDisperse for EOAs).
