---
name: decision-naming
description: Names are ENSv2 on-chain subnames (*.soapay.eth, Sepolia) with per-employee resolvers; the sender pins the meta-address
metadata:
  type: project
---
**Changed 2026-09-25** from ENSv1 off-chain CCIP subnames to **ENSv2 on Sepolia**:
- `soapay.eth` has its own subname registry.
- Each employee gets an on-chain subname with its own Permissioned Resolver.
- Enhanced Access Control lets only the employee's registrant key edit that name's `stealth` text record. The subname is non-transferable and the parent can revoke it.
- `addr` stays unset, so plain wallets can't pay a static address.
- The API's issuer key holds only the subname-registration role.

The sender resolves a name once at enrollment, **pins the ERC-6538 meta-address**, and alerts the employer if it changes.

**Why:** the ENSv2 prize requires ENSv2 to be central, and on-chain per-employee records remove trust in a gateway signer, who could otherwise redirect salaries. The earlier ENSv1 resolver work was stopped unmerged.
**How to apply:** follow docs/mvp-spec.md §2 and `contracts/ENSV2.md`. There is no CCIP route in apps/api. Meta-address rotation is gated by World ID ([[decision-bounties]]).
