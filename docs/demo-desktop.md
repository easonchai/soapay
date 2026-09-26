# Demo script: desktop only (2:45)

One laptop, two browser profiles side by side, plus Claude Code for the agent and a terminal for the thief. The phone is used only as the **World ID app** (to scan the QR); it is never mirrored. Full background, pre-staging and fallbacks: [demo-flow.md](demo-flow.md).

**Screen layout:** left half, the **Employer** profile (company app, Meridian Labs). Right half, the **Employee** profile (employee app, Alex). Claude Code and the terminal are one keystroke away. If a live step stalls for more than ~8 s, take its fallback and keep talking.

| # | Beat | Time | Where |
| --- | --- | --- | --- |
| 1 | Invite Alex and the agent | 0:00–0:15 | Employer |
| 2 | Alex signs up | 0:15–0:50 | Employee (+ phone scan) |
| 3 | What the name holds | 0:50–1:00 | Employee |
| 4 | The agent joins | 1:00–1:15 | Claude Code |
| 5 | Pay run and two views | 1:15–1:45 | Employer → Employee |
| 6 | The agent spends | 1:45–2:05 | Claude Code |
| 7 | Recovery and the thief | 2:05–2:40 | Employee → terminal → Employer |
| 8 | Close | 2:40–2:45 | |

## 1. Invite (0:00–0:15) · Employer

- **Do:** Recipients → Invite employee `alex-demo` → **Sign and create link** → **Copy link**. Same for `billing-agent` → **Copy link**.
- **Say:** "Meridian pays in USDC on Base. We invite a *name*, not a wallet."

## 2. Alex signs up (0:15–0:50) · Employee

- **Do:** paste Alex's link → **Create a new account** → **Copy phrase**, tick, **Continue** → **Passkey** → **Use Face ID / fingerprint (passkey)** (Touch ID) → **Register for free** → **Continue** → **Protect with World ID** → scan the QR with the phone, approve Proof of Human (the name is claimed; ~15 s) → **Share this one string…**
- **Say:** "Keys are made in this browser and locked with Touch ID. No wallet, no gas. One World ID scan links a real human to `alex-demo.soapay.eth`."
- **Glance left:** Alex appears in the Employer's list within ~5 s.
- **Fallback:** a third profile, `alex-backup`, already signed up.

## 3. What the name holds (0:50–1:00) · Employee, Name tab

- **Say:** "The name holds one `stealth` record on Alex's own ENSv2 resolver. Only Alex's key can change it. No `addr`, on purpose."

## 4. Agent joins (1:00–1:15) · Claude Code

- **Do:** "Join Meridian Labs payroll with this invite: ‹link›" → `create_agent_identity` → `billing-agent.soapay.eth`.
- **Say:** "Same link. The agent makes its own keys and claims its name, with agent records. The company sees it join, like Alex."
- **Fallback:** the pre-joined agent.

## 5. Pay run (1:15–1:45) · Employer, then Employee

- **Do (Employer):** **Start pay run** → **Resolve names** → **Review** → **Sign and send** → Basescan tab.
- **Do (Employee):** **Payments** → **Rescan** → **Pay runs** → **Two views**: Coworker view ↔ My view.
- **Say:** "One signature, one transaction, many fresh addresses. A coworker sees the whole batch, no names. Alex's key lights up only Alex's lines."
- *(Start `pnpm demo:attacker sam-demo` in the terminal now; it takes ~15 s.)*
- **Fallback:** the rehearsal run's Basescan tab and its Two views.

## 6. The agent spends (1:45–2:05) · Claude Code

- **Do:** "What was I paid? Then send 0.5 USDC to alex-demo.soapay.eth." → `scan` → `spend` plan → "yes, confirm" → Basescan.
- **Say:** "The agent finds its lines among everyone's and pays Alex by name, from an address holding zero ETH. Gas is sponsored."
- **Fallback:** the recorded agent spend.
- **If the agent beats are cut:** use this slot for **dApps**: connect one of Alex's addresses to Aave (Base Sepolia) with WalletConnect. "Your salary address plugs into DeFi, one address per app, gas sponsored."

## 7. Recovery and the thief (2:05–2:40)

- **Say:** "Say Alex's recovery phrase leaked."
- **Do (Employee):** **Name** → **Rotate to new keys** → **Continue to World ID** → **Confirm it's you with World ID** (scan with the phone) → **Keys rotated**.
- **Do (Employer):** **Resolve names** → alex-demo: **Re-verified by World ID**.
- **Say:** "Same human, so the company follows the new keys by itself. And a thief?"
- **Do (terminal → Employer):** the attacker summary → **Resolve names** → sam-demo: **Blocked · record changed**.
- **Say:** "The thief had sam's phrase and rewrote sam's record. But they're not sam: no World ID proof, so the money doesn't follow."

## 8. Close (2:40–2:45)

- **Say:** "One name, a fresh address every payday, for people and agents. Coworkers see the batch, not the salaries, and only the human can move the pay."

## Before the demo

1. **Browser profiles** (Chrome or Dia):
   - **Employer:** MetaMask with the company wallet, logged in to the company app, vault unlocked, roster of 10+ pinned names including `sam-demo`. Use the **same wallet** for invites and pay runs (otherwise Alex sees "Unknown payer").
   - **Employee:** fresh, with no Soapay data (`alex-demo` must be unclaimed: `curl https://soapay.up.railway.app/api/names/alex-demo` → `not_found`), and Touch ID available.
   - **alex-backup:** fully signed up the day before, World ID linked, in the roster (fallback for beats 2 and 7).
2. **Phone:** World ID app open and verified; used only to scan QR codes.
3. **Claude Code:** Soapay MCP connected (`/mnt/storage/soapay/docs/demo-flow.md`, Before the demo, item 5), clean session, env hidden.
4. **Terminal:** `pnpm demo:attacker sam-demo` typed, not run. After the demo: `pnpm demo:attacker sam-demo --restore`.
5. **Tabs warm:** Basescan (pass its Cloudflare check by hand), Sepolia Etherscan.
6. **Freeze merges to `main` an hour before:** every merge redeploys.
7. **Rehearse once end to end** and record it; the recording is every fallback.
