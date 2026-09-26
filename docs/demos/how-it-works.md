# How it works (judges' Q&A)

Short answers, one topic each. Deeper detail: [architecture.md](../architecture.md), [privacy-model.md](../privacy-model.md), [worldid.md](../worldid.md), [contracts/ENSV2.md](../../contracts/ENSV2.md).

**Who we protect against:** a **coworker** in the same payroll batch. They know their own pay, can read the whole batch on-chain, and probably know your main wallet. The **employer is trusted** and may know everything.

## Stealth addresses

Each person publishes one **stealth meta-address**: two public keys, a spending key and a viewing key (ERC-6538 format). For every payment, the payer mixes those keys with a one-time random key and gets a **brand-new address** (ERC-5564). Only the owner's viewing key can recognise it, and only their spending key can move funds from it.

```
ENS name ──► meta-address (2 public keys)
                  │  + a new random key per payment
                  ▼
    fresh address 1   fresh address 2   fresh address 3 …   (one per 500 USDC chunk)
```

- The payer posts one **announcement** per payment on the canonical ERC-5564 Announcer: the address and the one-time public key.
- A **view tag** (one byte) lets the owner's app skip about 255 of 256 announcements without doing the full math.
- **Why a coworker can't link lines:** without your viewing key, your addresses look like everyone else's. Maya can find her own lines; every other line is "unknown".

## Chunk sizes (denominations)

A salary is paid as equal **chunks** (for example 500 USDC), plus one smaller remainder line.

- If lines were whole salaries, a coworker who knows one person earns 5,250 could spot that line.
- With 500 USDC chunks, almost every line is 500, so amounts identify nobody.
- One chunk size for the whole company (Settings). Smaller chunks mean more lines and more gas.
- Honest limit: if you later spend several chunks together, they become linked to each other. The app warns you first.

## StealthDisperse (one transaction)

Our only custom contract. In one transaction it pulls the total from the company with `transferFrom`, sends each line to its fresh address, and announces each line.

- **Up to 350 lines per transaction.** Our demo run is about 125 lines: one transaction, two MetaMask prompts (approve, then pay).
- **Addresses must be strictly ascending.** The order says nothing about names, and duplicates are rejected on-chain.
- **Holds no funds, keeps no state.** Nothing to drain.
- Bigger runs are split into several transactions after a **global** sort, never one transaction per person (totals would leak salaries).
- Smart-account employers skip the contract: the same lines go out as one EIP-5792 batch.

## Gasless spending (EIP-7702)

A fresh address holds USDC and **zero ETH**. So how does it pay gas?

```
first spend from 0xD259 (500 USDC, 0 ETH, no code)
   1. 0xD259 signs a 7702 authorization: "my code = Simple7702Account"
   2. one user operation: transfer USDC
   3. a paymaster pays the gas
after: 0xD259 is a smart account, same address, same key
```

- **Simple7702Account** is the standard, audited account from the ERC-4337 team. Nothing is deployed per address.
- **First spend upgrades the address.** Later spends skip step 1.
- **Testnet:** a sponsoring paymaster (Pimlico, through Soapay's API). **Mainnet:** Circle's paymaster takes the fee in USDC.
- The spending key never leaves your device.

## ENS

Every person or agent gets `<label>.soapay.eth`, an ENSv2 name on Sepolia.

- **One resolver per employee.** Each name has its own resolver, so no one can write anyone else's record.
- **Scoped write permission.** The employee's key can change only the `stealth` text record, nothing else.
- **No `addr` record, on purpose.** A normal wallet can't pay the name to one fixed address that coworkers could watch.
- **Cross-check:** the same meta-address is in the ERC-6538 registry on Base. The payer checks both match.
- **Pinning:** the company app resolves a name once and **pins** its keys. Every pay run re-checks. A changed record is paid only with a World ID attestation or the employer's manual approval.
- **Agents:** ENSIP-26 records next to `stealth`: `agent-context` (what the agent does) and `agent-endpoint[<protocol>]` (where to reach it).

## World ID

World ID guards the most sensitive action: **changing the keys a name points to** (recovery).

```
sign-up:   link a World ID session (Proof of Human) to the name ──► stored by Soapay's API
rotation:  prove the SAME session ──► API signs an EIP-712 attestation ──► company app follows the new keys
thief:     different World ID, or none ──► no attestation ──► line blocked
```

- **On-chain:** the ENS `stealth` record and the ERC-6538 entry. Whoever holds the key can change them.
- **Off-chain, at Soapay's API (the attester):** which World ID session backs which name, and the signed EIP-712 attestations.
- **The payer requires the attestation.** A changed record without one is blocked: "Blocked · record changed".
- World ID proves a unique human without revealing who. The API never sees identity data.
- Without World ID, recovery still works: the employer approves the new keys by hand.

## Agents via MCP

An AI agent uses the Soapay **MCP server** (stdio), the same SDK code as the apps.

- `create_agent_identity`: its own keys and name, from the same invite link a person gets.
- `scan`: find its lines in a pay run. `balance`, `whoami`.
- `spend` / `pay`: plan first, confirm, then send. Gasless spends, as above.
- Guardrails: per-call and per-day caps (5 and 20 USDC by default), and pinned names.

## Out of scope for v1

- **Chain analysts** with big data, and **RPC or bundler linkage** (who asked which node about which address).
- Timing correlation across many pay runs. Research for later: [shielded-rail-research.md](../shielded-rail-research.md).
- A leaked phrase can still spend what was already received. World ID protects **future** pay.
