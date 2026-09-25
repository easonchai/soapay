---
name: decision-naming
description: v1 names are platform-issued offchain subnames (*.soapay.eth) via a static CCIP-Read resolver
metadata:
  type: project
---
v1 issues offchain subnames (e.g. alice.soapay.eth) served by a CCIP-Read resolver; no L1 gas, no main-wallet signature. The Base-coinType addr record is NOT pointed at the registrant.

**Why:** the PRD's `addr = registrant` makes any plain wallet pay one static address (breaks privacy and links payments), and L1 ENS writes can't be paid by a Base paymaster. Decided 2026-09-25.
**How to apply:** the sender app finds the registrant via the `stealth` text record / ERC-6538, not via `addr`. Needs soapay.eth plus an OffchainResolver contract on L1; that contract holds no funds, but it is a custom deploy, so PRD wording "nothing custom" needs an exception. See [[prd-open-questions]].
