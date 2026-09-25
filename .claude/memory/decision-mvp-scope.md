---
name: decision-mvp-scope
description: MVP scope is the full buildable PRD minus gateway derivation and Privacy Pools; testnet first, specs in docs/mvp-spec.md
metadata:
  type: project
---
On 2026-09-25 the owner took over contracts + backend from the teammate and asked for "as complete as it can be" with no timeline pressure. Scope:
- **In:** StealthDisperse (calldata-packed), the SoapayOffchainResolver (ENS CCIP-Read), SDK (keys, registration, names, payrun, scan, spend, guard, denominations, Safe), `apps/api` (subname gateway, registration relayer, announcement indexer), and the recipient and sender apps.
- **Out:** gateway *derivation* mode (M3) and the Privacy Pools exit, because the team threat model proposes cutting them. Revisit with the team before building.
- **Decisions:** pack the calldata now (PLAN Q5). Token restriction and payer filtering live in the clients only; the contract stays stateless (Q3/Q4). Deploy to Base Sepolia first; the owner broadcasts with their own keystore.

**Why:** the owner wants the whole product built, not a slice.
**How to apply:** `docs/mvp-spec.md` is the interface contract between workstreams; change the spec before the code. Progress lives in [[build-status]].
