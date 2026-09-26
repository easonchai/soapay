# World ID demo (~2 min)

World ID is how you recover your pay if your recovery phrase leaks, and why a thief with that phrase still can't redirect it. Setup: [README.md](README.md).

**On screen:** the Employee profile (employee app), the Employer profile (company app), the phone with World App, and the thief terminal.

**What lives where (be precise if asked):**

- The **ENS record** (`stealth`) is on-chain. Whoever holds the name's key can rewrite it, a thief included.
- The **link between the name and a World ID session** lives with Soapay's API, which acts as the attester. When the same session proves itself, the API signs an **EIP-712 attestation** for the new keys.
- The **payer's app** follows a changed record only with that attestation. No attestation: the line is blocked.

| # | Beat | Time |
| --- | --- | --- |
| 1 | Sign up and link World ID | 0:00–0:35 |
| 2 | Phrase leaked: rotate | 0:35–1:05 |
| 3 | The thief tries their own World ID | 1:05–1:35 |
| 4 | The thief rewrites ENS directly | 1:35–1:55 |
| 5 | Close | 1:55–2:00 |

## 1. Sign up and link World ID (0:00–0:35)

- **Do (Employer):** **Recipients → Invite employee** `alex-meridian` → **Sign and create link** → **Copy link**.
- **Do (Employee):** open the link → **Create a new account** → **Copy phrase** (save it: the thief uses it later), tick, **Continue** → passkey → **Register for free** → **Continue** → **Protect with World ID** → scan the QR with the phone → approve **Proof of Human**.
- **Say:** "Alex signs up and links a World ID session to `alex-meridian.soapay.eth`. World ID proves a real, unique human, without saying who."
- **Fallback:** `alex-demo`, signed up and linked in rehearsal.

## 2. Phrase leaked: rotate (0:35–1:05)

- **Say:** "Say Alex's recovery phrase leaked."
- **Do (Employee):** **Name → Rotate to new keys → Continue to World ID → Confirm with World ID** → scan, approve → **Keys rotated**.
- **Do (Employer):** **Recipients → Re-verify all** → `alex-meridian`: **Re-verified by World ID**.
- **Say:** "Same session, same human, so Soapay signs an attestation and the company app follows the new keys by itself. No HR ticket."
- **Fallback:** `alex-demo`'s **Re-verified by World ID** pill from rehearsal.

## 3. The thief tries a World ID that isn't sam's (1:05–1:35)

- **Do (thief terminal):** `pnpm demo:attacker-worldid sam-demo`. It prints six steps: the thief has sam's phrase → signs a key change to keys the thief controls → presents a World ID answer that isn't sam's → **the API's refusal, verbatim** (`403 session_mismatch`) → reads ENS and the attestation feed back: **name unchanged, no attestation**.
- **Do (Employer):** **Re-verify all** → `sam-demo` is still **Verified**.
- **Say:** "The stolen phrase, the signed key change and Soapay's refusal are real, against the live API. The only simulated part is the thief's World ID answer: it's for a different World ID session, and Soapay checks which session is answering before it even calls World. That's exactly where a real stranger's proof fails."
- **Optional (10 s):** `pnpm demo:attacker-worldid sam-demo --replay` replays sam's *own genuine* proof from sign-up → refused again (`session_replayed`): a proof works only once.
- **Live alternative (only if you have a second person's World App):** restore sam's phrase in a Chrome Guest window → **Name → Rotate to new keys → Continue to World ID → Confirm it's you with World ID** → scan with the second World App → the red **Refused** box.

## 4. The thief rewrites ENS directly (1:35–1:55)

- **Do (thief terminal):** `pnpm demo:attacker sam-demo` (~15 s): "Record rewritten on-chain ✓. Attestation: refused."
- **Do (Employer):** **Re-verify all** → `sam-demo`: **Blocked · record changed**.
- **Say:** "Skip Soapay and rewrite the ENS record on-chain? That works. But there's no attestation, so the company app blocks the line. The money doesn't follow."
- **Fallback:** run it before the demo and show its Etherscan link and the blocked pill.

## 5. Close (1:55–2:00)

- **Say:** "Only the human who set up the name can move the pay."

## If asked

Full answers: [how-it-works.md](how-it-works.md).

- **Can the thief spend what Alex already received?** Yes, with the phrase. World ID protects future pay. Move funds and rotate as soon as a leak is suspected.
- **No World ID?** Recovery still works: the employer approves the new keys by hand.
- **Linking World ID later?** Allowed, with a 72-hour wait before it can back a rotation (0 on this testnet demo).

After the demo: `pnpm demo:attacker sam-demo --restore`.
