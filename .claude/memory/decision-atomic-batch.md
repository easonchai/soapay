---
name: decision-atomic-batch
description: Sender pay runs use EIP-5792 wallet_sendCalls atomic batches; no Disperse contract
metadata:
  type: project
---
A pay run is one atomic EIP-5792 `wallet_sendCalls` batch from the employer's own account: N × `USDC.transfer(stealthAddr, amt)` + N × `Announcer.announce(1, stealthAddr, ephPub, metadata)`. Safe MultiSend is the P1 multisig path.

**Why:** the PRD's "Disperse + announce via multicall" fails from an EOA because Disperse pulls via `transferFrom(msg.sender)` and msg.sender would be the multicall contract. Decided 2026-09-25.
**How to apply:** require wallets with atomic-batch capability (check `wallet_getCapabilities` `atomic` status); build metadata with ScopeLift `buildMetadataForERC20` so the scanner gets token + amount without fetching receipts. Watch the per-tx gas cap for large denominated batches.
