---
name: decision-gateway-announce
description: Gateway mode is out of scope under the agreed coworker threat model; the announce-at-resolve choice is dormant
metadata:
  type: project
---
Under the team threat model (CLAUDE.md: the only adversary is a coworker, the employer is trusted), gateway mode is **out of scope and proposed for cut from v1**. `apps/gateway` stays a stub.

Earlier choice, dormant: if gateway mode returns, it announces at resolve per the PRD (chosen 2026-09-25), with the known risk that the Announcer's indexed `caller` links every address a per-recipient gateway issues, plus gas and counter griefing.

**Why:** the teammate's agreed threat model removed gateway mode.
**How to apply:** don't build gateway derivation unless the team restores the feature. If it is restored, revisit the caller-linkage mitigation (shared announcing relayer, rate limits) first.
