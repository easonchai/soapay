---
name: decision-naming
description: Names are offchain *.soapay.eth subnames; the sender resolves once at enrollment and pins the meta-address
metadata:
  type: project
---
v1 issues offchain subnames (e.g. alice.soapay.eth) through a CCIP-Read resolver; no L1 gas and no main-wallet signature. The Base-coinType addr record is NOT pointed at the registrant. Per the team threat model, ENS is only a reference identifier: the sender app resolves it once at enrollment, **pins the ERC-6538 meta-address**, and alerts the employer if it ever changes.

**Why:** `addr = registrant` would make any plain wallet pay one static address, and L1 ENS writes can't be paid by a Base paymaster. Pinning stops a changed name record from silently redirecting salaries. Decided 2026-09-25.
**How to apply:** caching the meta-address is fine; never cache a stealth address. Serving subnames needs soapay.eth plus an OffchainResolver on L1; it holds no funds, but it would be a second custom contract. See [[prd-open-questions]].
