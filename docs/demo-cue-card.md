# Demo cue card (2:45)

The short version of [demo-flow.md](demo-flow.md) to walk through on stage. The full script has the pre-staging, exact labels and every fallback. Rule: if a live step stalls for more than ~8 s, take the fallback and keep talking.

**Cast:** laptop (company app, Claude Code, a terminal) and Alex's phone (employee app), both mirrored. Company: **Meridian Labs**.

| # | Beat | Time | Shows |
| --- | --- | --- | --- |
| 1 | Invite a person and an agent | 0:00–0:15 | names, not wallets |
| 2 | Alex signs up | 0:15–0:45 | ENSv2 name, World ID link |
| 3 | What the name holds | 0:45–0:55 | ENSv2 `stealth` record, no `addr` |
| 4 | The agent joins | 0:55–1:10 | same invite, ENSIP-26 records |
| 5 | Pay run | 1:10–1:40 | one tx, fresh addresses, two views |
| 6 | The agent spends | 1:40–2:05 | gasless 7702 spend |
| 7 | Recovery and the thief | 2:05–2:40 | World ID |
| 8 | Close | 2:40–2:45 | |

## 1. Invite (0:00–0:15) · laptop, Recipients

- **Do:** Invite employee `alex-demo` → **Sign and create link** → QR. Same form for `billing-agent` → **Copy link**.
- **Say:** "Meridian pays in USDC on Base. We invite a *name*, not a wallet: Alex gets a QR, our billing agent gets the same link in chat."

## 2. Alex signs up (0:15–0:45) · phone

- **Do:** scan QR → **Create a new account** → **Copy phrase**, tick, **Continue** → passkey (Face ID) → **Register for free** → **Continue** → **Set up with World ID** → approve Proof of Human in the World App → **Share this one string…**
- **Say:** "Keys are made on the phone and locked with Face ID. No wallet, no gas. Alex gets `alex-demo.soapay.eth`. One World ID tap links a real human to this name: that's what lets Alex recover later."
- **Laptop:** Alex's row appears within ~5 s.
- **Fallback:** switch to `alex-backup` ("one I made earlier").

## 3. What the name holds (0:45–0:55) · phone, Name tab

- **Say:** "The name holds one `stealth` record on Alex's own ENSv2 resolver; only Alex's key can change it. No `addr` on purpose, so coworkers can't watch a fixed address."

## 4. Agent joins (0:55–1:10) · Claude Code

- **Do:** "Join Meridian Labs payroll with this invite: ‹link›" → `create_agent_identity` → `billing-agent.soapay.eth`.
- **Say:** "Same link. The agent makes its own keys and claims its name, with ENSIP-26 agent records. The company sees it join, just like Alex."
- **Fallback:** the pre-joined agent.

## 5. Pay run (1:10–1:40) · laptop, then phone

- **Do:** **Start pay run** → **Resolve names** → **Review** → **Sign and send** → Basescan. Phone: **Payments** → **Pay runs** → **Coworker view** ↔ **My view**.
- **Say:** "One signature, one transaction, many fresh addresses. Every name is checked against its pinned keys. This is what a coworker sees: the whole batch, no names. And Alex's view: only Alex's key lights up Alex's lines."
- **Fallback:** the rehearsal run's Basescan tab.
- *(Start `pnpm demo:attacker sam-demo` in the second terminal now.)*

## 6. Agent spends (1:40–2:05) · Claude Code

- **Do:** "What was I paid? Then send 0.5 USDC to alex-demo.soapay.eth." → `scan` → `spend` plan → "yes, confirm" → Basescan.
- **Say:** "The agent finds its lines among everyone's and pays Alex by name. The sending address holds zero ETH; gas is sponsored. On mainnet, Circle's paymaster takes it in USDC."
- **Fallback:** the recorded gasless spend tx.

## 7. Recovery and the thief (2:05–2:40)

- **Say:** "Say Alex's recovery phrase leaked."
- **Phone:** **Name** → **Rotate to new keys** → **Continue to World ID** → **Confirm with World ID** → **Keys rotated**.
- **Laptop:** **Resolve names** → alex-demo: **Re-verified by World ID**.
- **Say:** "Same human, so the company's app follows the new keys by itself. And a thief?"
- **Terminal + laptop:** the attacker summary → **Resolve names** → sam-demo: **Blocked · record changed**.
- **Say:** "The thief had sam's phrase and rewrote sam's record. But they're not sam: no World ID proof, so the money doesn't follow."
- **Fallback:** `alex-backup`'s rotated pill; the attacker's Etherscan link.

## 8. Close (2:40–2:45)

- **Say:** "One name, a fresh address every payday, for people and agents. Coworkers see the batch, not the salaries, and only the human can move the pay."

## Flows worth knowing if asked

- **Keys:** the recovery phrase derives a spending key and a viewing key. The ENS `stealth` record holds only the two public keys. Each payment's address comes from those plus the sender's one-time key, so only Alex can find and open it.
- **Pinning:** the company app resolves each name once and pins its keys. A changed record is paid only with a World ID attestation or the employer's re-approval.
- **World ID:** a Proof of Human *session* is linked at sign-up; a rotation must prove the same session. It's bound to the change through the single-use RP nonce, and replays are refused. Linking later has a 72 h wait.
- **Gasless spend:** each stealth address is upgraded to a Simple7702Account on first spend, and a paymaster covers gas (Pimlico on testnet, Circle's USDC paymaster on mainnet).
- **What's out of scope:** chain analysts and RPC linkage. The adversary is a coworker; the employer is trusted.
- **Honest caveat:** World ID protects *future* pay. A leaked phrase can still spend what's already received, so rotate and move funds quickly.
