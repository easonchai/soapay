---
name: decision-atomic-batch
description: Pay runs use two paths, StealthDisperse for plain EOAs and an EIP-5792 batch for smart accounts
metadata:
  type: project
---
Two pay-run paths (team design in CLAUDE.md and contracts/PLAN.md; the smart-account path is pending team confirmation):
- **Plain EOA employers:** `contracts/src/StealthDisperse.sol`, via `pay` after approve, or `payWithPermit`. It is stateless, holds no funds, and requires stealth addresses strictly ascending.
- **Smart-account, 7702 and Safe employers:** a contract-less EIP-5792 atomic batch of `[USDC.transfer, Announcer.announce] × N`. Safes use `MultiSendCallOnly`.

**Why:** Disperse behind a multicall can't pull from an EOA. StealthDisperse fixes that for EOAs, but it is a USDC-blacklist chokepoint and permits fail for 7702 accounts, so smart accounts skip it. Superseded my 2026-09-25 "EIP-5792 only, no Disperse" decision after the teammate's contract landed.
**How to apply:** the sender app picks the path from wallet capabilities. On both paths: derive the whole run, sort globally by stealth address, and cut into txs of 350 lines or fewer; never split by employee. Metadata is 77 bytes (standard 57 plus payer); scanners must not trust metadata token or amount.
