# Demo script: desktop only (2:45)

One laptop, three browser profiles (Employer, Alex, and Maya the coworker), plus a terminal for the agent and a second terminal for the thief. The phone is used only as the **World ID app** (to scan the QR); it is never mirrored. Full background, pre-staging and fallbacks: [demo-flow.md](demo-flow.md).

**Screen layout (three macOS desktops, Ctrl + 1/2/3):**
1. **Employer** profile, full screen: the company app, Meridian Labs, 10 staff already on payroll.
2. **Employees**, split view: **Alex** (left, fresh profile, signs up live) and **Maya** (right, a coworker already on payroll).
3. **Terminal**: the agent tab and the thief tab.

 If a live step stalls for more than ~8 s, take its fallback and keep talking.

| # | Beat | Time | Where |
| --- | --- | --- | --- |
| 1 | Invite Alex and the agent | 0:00–0:15 | Employer |
| 2 | Alex signs up | 0:15–0:50 | Employee (+ phone scan) |
| 3 | What the name holds | 0:50–1:00 | Employee |
| 4 | The agent joins | 1:00–1:15 | Agent terminal |
| 5 | Payday: unlinkability | 1:15–1:45 | Employer → Maya → Alex |
| 6 | The agent spends | 1:45–2:05 | Agent terminal |
| 7 | Recovery and the thief | 2:05–2:40 | Employee → terminal → Employer |
| 8 | Close | 2:40–2:45 | |

## 1. Invite (0:00–0:15) · Employer

- **Do:** Recipients → Invite employee `alex-meridian` → **Sign and create link** → **Copy link**. Same for `billing-agent` → **Copy link**.
- **Say:** "Meridian Labs pays ten people in USDC on Base. Adding two more: we invite a *name*, not a wallet."

## 2. Alex signs up (0:15–0:50) · Employee

- **Do:** paste Alex's link → **Create a new account** → **Copy phrase**, tick, **Continue** → **Passkey** → **Use Face ID / fingerprint (passkey)** (Touch ID) → **Register for free** → **Continue** → **Protect with World ID** → scan the QR with the phone, approve Proof of Human (the name is claimed; ~15 s) → **Share this one string…**
- **Say:** "Keys are made in this browser and locked with Touch ID. No wallet, no gas. One World ID scan links a real human to `alex-meridian.soapay.eth`."
- **Glance left:** Alex appears in the Employer's list within ~5 s.
- **Fallback:** a third profile, `alex-demo`, already signed up (the pre-onboarded fallback persona).

## 3. What the name holds (0:50–1:00) · Employee, Name tab

- **Say:** "The name holds one `stealth` record on Alex's own ENSv2 resolver. Only Alex's key can change it. No `addr`, on purpose."

## 4. Agent joins (1:00–1:15) · Agent terminal

- **Do:** `pnpm demo:agent join` → paste the `billing-agent` link at the prompt (it is wiped from the screen) → `▸ create_agent_identity` → `billing-agent.soapay.eth`, its ENSIP-26 `agent-context` record and the Etherscan link.
- **Say:** "Same link. The agent makes its own keys and claims its name, with agent records. This is the real MCP server an agent would use, driven from the terminal. The company sees it join, like Alex."
- **Alternative:** Claude Code with the Soapay MCP connected: "Join Meridian Labs payroll with this invite: ‹link›" → `create_agent_identity`.
- **Fallback:** the pre-joined agent.

## 5. Payday: unlinkability (1:15–1:45) · Employer, then Maya, then Alex

- **Do (Employer):** **Start pay run** → **Resolve names** (every row **Verified**) → **Review**.
- **Say (read the headline):** "About 60,000 USDC to 12 payees, on roughly 125 fresh addresses. Every line is 500 USDC, a few are 250. No amount points to a person."
- **Do (Employer):** **Sign and send** (two MetaMask prompts: approve, then pay) → the Basescan tab.
- **Say:** "Publicly: one transaction to 125 strangers."
- **Do (Maya, right):** **Payments** → **Rescan** → **Pay runs** → **Two views**, Coworker view.
- **Say:** "Maya is the adversary our threat model cares about: a coworker in the same batch who knows her own pay. She sees her lines, and every other line is 'unknown'. She can't find Alex's."
- **Do (Alex, left):** same run → **My view**.
- **Say:** "Same transaction; only Alex's key lights up Alex's lines."
- *(Start `pnpm demo:attacker sam-demo` in the thief terminal now; it takes ~15 s.)*
- **Fallback:** the rehearsal run's Basescan tab and its Two views.

## 6. The agent spends (1:45–2:05) · Agent terminal

- **Do:** `pnpm demo:agent spend 0.5 alex-meridian` → `▸ scan` ("N lines in this pay run; 2 are mine", real balances; it waits up to ~20 s for the indexer) → `▸ spend` plan (guard `allow`, gas sponsored) → **Enter** at "Confirm this spend?" → Basescan link → "source address … ETH: 0".
- **Say:** "The agent finds its lines among everyone's and pays Alex by name, from an address holding zero ETH. Gas is sponsored."
- **Alternative:** Claude Code: "What was I paid? Then send 0.5 USDC to alex-meridian.soapay.eth." → `scan` → `spend` plan → "yes, confirm" → Basescan.
- **Fallback:** the recorded agent spend.
- **If the agent beats are cut:** use this slot for **dApps**: connect one of Alex's addresses to Aave (Base Sepolia) with WalletConnect. "Your salary address plugs into DeFi, one address per app, gas sponsored."

## Agent beats from the terminal

`pnpm demo:agent` starts the Soapay MCP server (`apps/mcp/dist/index.js`) over stdio and calls its tools with the MCP SDK client: the same tools, arguments and guardrails an agent host uses, with no LLM in the loop, so nothing on stage depends on a model's wording. Each step prints its tool name (`▸ create_agent_identity`, `▸ scan`, `▸ spend`) and a spinner with elapsed seconds.

| Command | What it shows |
| --- | --- |
| `pnpm demo:agent init` | Writes a fresh agent recovery phrase to `scripts/.demo-agent.local.env` (git-ignored, 0600) if there is none. Never prints it |
| `pnpm demo:agent status` | `whoami` (name, payer, caps) and `balance` |
| `pnpm demo:agent join` | Paste the invite link at the prompt → `create_agent_identity`: name, ENSIP-26 records, Etherscan link, and a read-back of `agent-context` from ENS |
| `pnpm demo:agent spend 0.5 alex-meridian` | `scan` → "N lines in this pay run; K are mine" → `spend` plan → confirm → Basescan link → "source address ETH: 0" |

Add `--pause` to wait for **Enter** before each step while you narrate, and `--yes` to skip the confirm prompt. The env file also takes `AGENT_PAYER_PRIVATE_KEY` (default: `contracts/.env`'s deployer key), `STATE_DIR` (default `scripts/.demo-state/demo-agent`), `API_URL`, `RPC_URL` and `ENS_RPC_URL`. Keys, the phrase and the invite code are never printed.

## 7. Recovery and the thief (2:05–2:40)

- **Say:** "Say Alex's recovery phrase leaked."
- **Do (Employee):** **Name** → **Rotate to new keys** → **Continue to World ID** → **Confirm it's you with World ID** (scan with the phone) → **Keys rotated**.
- **Do (Employer):** **Resolve names** → alex-meridian: **Re-verified by World ID**.
- **Say:** "Same human, so the company follows the new keys by itself. And a thief?"
- **Do (terminal → Employer):** the attacker summary → **Resolve names** → sam-demo: **Blocked · record changed**.
- **Say:** "The thief had sam's phrase and rewrote sam's record. But they're not sam: no World ID proof, so the money doesn't follow."

## 8. Close (2:40–2:45)

- **Say:** "One name, a fresh address every payday, for people and agents. Coworkers see the batch, not the salaries, and only the human can move the pay."

## Before the demo

0. **Seed the company** (once, from the repo root): `pnpm demo:seed-company` (`--dry` to preview; idempotent). It claims ten employees (`maya-ml` … `ines-ml`) on the live stack and writes `scripts/.demo-roster.local.csv` (the ten plus `sam-demo`, 59,750 USDC) and `scripts/maya-ml.recovery-kit.local.txt`. Both files hold secrets; never commit them.
1. **Browser profiles** (Chrome or Dia):
   - **Employer:** MetaMask with the company wallet **`0xA872…8818`** (a plain account with Base Sepolia ETH and 1,000,000 mock USDC; decline MetaMask's smart-account switch). Log in to the company app, create the vault with **Wallet signature**. **Pay run → Import CSV** → the roster file (resolves and pins each name). **Settings:** chunk size **500** USDC, Denominated payouts on (about 125 lines in one tx; the testnet default of 5 would make ~12,000). **Back up now.** Use this **same wallet** for invites and pay runs (otherwise Alex sees "Unknown payer").
   - **Maya (the coworker):** employee app → **Restore from recovery phrase** → open `scripts/maya-ml.recovery-kit.local.txt` → set a passkey.
   - **Employee:** fresh, with no Soapay data, and Touch ID available. The live sign-up label must be unclaimed: `curl https://soapay.up.railway.app/api/names/alex-meridian` → `not_found` (`alex-demo` is already claimed live, so it can't be the live sign-up).
   - **alex-demo:** the pre-onboarded fallback persona, fully signed up, World ID linked, in the roster (fallback for beats 2 and 7). `curl …/api/names/alex-demo` returns the name.
2. **Phone:** World ID app open and verified; used only to scan QR codes.
3. **Agent terminal**, from a clean clone of this branch after `pnpm install && pnpm build`:
   - `pnpm demo:agent init` once (fresh phrase, never shown), then `pnpm demo:agent status`: "no name yet", 0 USDC, and the payer's USDC and ETH.
   - `billing-agent` must be unclaimed: `curl …/api/names/billing-agent` → `not_found`.
   - Rehearse `join` and `spend` on a **throwaway** label and env file (`pnpm demo:agent join --env /tmp/rehearsal.env`), never on `billing-agent`.
   - The API allows **3 registrations per IP per hour** (`RATE_LIMIT_REGISTER_PER_IP`); the live `join` is one. Don't rehearse registrations from the venue network in the last hour.
   - Alternative: **Claude Code** with the Soapay MCP connected ([demo-flow.md](demo-flow.md), Before the demo, item 5), clean session, env hidden.
4. **Thief terminal:** `pnpm demo:attacker sam-demo` typed, not run. After the demo: `pnpm demo:attacker sam-demo --restore`.
5. **Tabs warm:** Basescan (pass its Cloudflare check by hand), Sepolia Etherscan.
6. **Freeze merges to `main` an hour before:** every merge redeploys.
7. **Rehearse once end to end** and record it; the recording is every fallback.
