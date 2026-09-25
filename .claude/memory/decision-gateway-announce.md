---
name: decision-gateway-announce
description: Gateway mode keeps announce-at-resolve per the PRD, despite known caller-linkage risk
metadata:
  type: project
---
In M3 the gateway announces on-chain at resolution time, as the PRD specifies. Team chose this on 2026-09-25 over "recipient scans counter-derived addresses".

**Why:** keep to the PRD's invariant 3 (announcement before payment).
**How to apply:** known risk to design around in M3: the Announcer's indexed `caller` is the gateway's address, so a per-recipient self-hosted gateway links all that recipient's announcements; resolving names also costs the gateway gas and burns counter values (griefing). Consider a shared announcing relayer and strict per-name rate limits.
