---
name: decision-frontend-m1
description: Frontend M1 as built: signature-derived keys, relayer in gateway, three sender modes, bounded scanner, UI tokens
metadata:
  type: project
---
> **Superseded where they differ by [[decision-ck-integration]] (2026-09-26 merge).** Keys: a recovery phrase is the default; this signature derivation survives only as an EOA-only option (SDK `keysFromWalletSignature`; smart/passkey wallets refused). Relayer: `apps/gateway` is deleted; `POST /relay` (same request shape) lives in `apps/api` on the `/register` path. Sequential mode: dropped (EIP-5792 > StealthDisperse > Safe export). Naming: the "link an existing name" step is replaced by `*.soapay.eth` ENSv2 issuance + invites. Spending: "reveal private key" is replaced by the guarded gasless Send and the Exit; key export only as advanced recovery. His stores (company/recipient/sender, localStorage) are replaced by our encrypted vaults; his formatters, `findRegistrationBlock` and live-balance status moved into the SDK. The rest below is the historical M1 record.

Recipient and sender apps (M1 P0) landed 2026-09-25 on the Vite SPA layout; protocol logic lives in `@soapay/sdk` (45 vitest tests), shared styles and components in `@soapay/ui`.

- **Keys:** derived from one wallet signature (ScopeLift `generateKeysFromSignature`); the throwaway registrant key is `keccak256(signature ‖ "soapay/registrant/v1")`. Recovery = sign again. This is the implemented default while the BIP-39 question in [[decision-scope-v1]] stays open; switching later means a new derivation function plus a migration note, not a UI change.
- **Registration:** the recipient app signs the ERC-6538 EIP-712 payload with the registrant key and POSTs it to `apps/gateway` `POST /relay`, which submits `registerKeysOnBehalf` from `RELAYER_PRIVATE_KEY`. Same request shape for the hosted relayer later.
- **Naming step:** the wizard's "link a name" only checks an existing `addr` record and is skippable. It does not implement the `*.soapay.eth` subnames in [[decision-naming]]; that step is replaced when the OffchainResolver ships.
- **Sender modes** (`createWalletBatchSender`): EIP-5792 atomic batch > `StealthDisperse.payWithPermit` when `VITE_STEALTH_DISPERSE_ADDRESS` is set > sequential announce-then-pay. A partial run throws `BatchPartialError` and the UI retires the rows so nothing is paid twice. Per [[decision-atomic-batch]].
- **Scanner:** bounded `eth_getLogs` from the registration block (recovered via `StealthMetaAddressSet` when registered elsewhere), 2000-block chunks; metadata decoded by offset for both 57- and 77-byte layouts; headline total comes from live `balanceOf`, never metadata.
- **Not persisted:** private keys (React state only). Stored: public recipient state + ledger; on the company side, pins, the draft, and a payment history (employee -> stealth wallet, amount, tx) so the company can track each employee's wallets and live balances. The employer is trusted under the threat model, so this is allowed; a stored wallet is a record and never a payment target.
- **UI (2026-09-26):** the user's design package (Direction A · Ledger: light canvas, navy #1E3A5F, IBM Plex Sans/Mono, 2px corners, dot-matrix texture) is the reference. Tokens in `packages/ui/src/styles.css`; the sender screens follow `Soapay Sender App.dc.html` (Pay run, Review & sign, History, Recipients) and the landing follows the marketing hero. Earlier glass/dark theme is gone.
- **Denominated payouts:** shipped in the sender (`expandDenominated`, default on, 500 USDC chunks, remainder as one smaller final line, 350-line cap).

**Why:** matches [[decision-app-stack]] (no server in the key-holding apps, SDK-only code paths) and the contract plan's client invariants (350-row cap, global sort, no ephemeral reuse).
**How to apply:** new protocol code goes in `packages/sdk` with a test; apps import only from `@soapay/sdk` and `@soapay/ui`.
