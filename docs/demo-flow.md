> **Superseded:** use the short scripts in [docs/demos/](demos/README.md) (finalist, World ID, ENS). This file, including its cue card, is kept for reference.

# Demo script: the 3-minute live demo

The demo slot is 4 minutes. A teammate pitches for the first minute (see [What the pitch minute covers](#what-the-pitch-minute-covers)); this is the **3-minute live demo** that follows. It tells one story, a company paying a person and an agent, and each bounty appears as a real product moment, not as a feature tour:

- **ENSv2:** the name *is* how the employer pays you. Sections 2, 3 and 4.
- **World IDKit (Proof of Human):** it's what lets you recover your pay, and what stops a thief from redirecting it. Sections 2 and 7.

The testnet has no exit (D-52), so it does not appear. Everything runs live on **Base Sepolia with Soapay's mock USDC**, with ENSv2 names on Sepolia.

**Cast:** the laptop (company app, Claude Code, a terminal, mirrored to the screen) and one phone ("Alex", the employee app, mirrored too). The company is **Meridian Labs**.

**Labels on screen are quoted exactly** as the code renders them on the `demo-script` branch (2026-09-26). Where the owner's wording differs from the app, the app's words are given.

## Timing

| # | Section | Time | Ends at | Bounty |
| --- | --- | --- | --- | --- |
| 1 | Employer invites a person and an agent | 0:20 | 0:20 | (sets up ENSv2) |
| 2 | The person signs up (phone) | 0:35 | 0:55 | ENSv2, World ID |
| 3 | What the name holds | 0:15 | 1:10 | ENSv2 |
| 4 | The agent joins | 0:15 | 1:25 | ENSv2 (agent records) |
| 5 | Disbursement, behind the scenes | 0:30 | 1:55 | (product claim) |
| 6 | The agent spends | 0:30 | 2:25 | (product claim) |
| 7 | Recovery: the real World ID moment | 0:30 | 2:55 | World ID |
| 8 | Closing line | 0:05 | 3:00 | |

There is no slack in the budget. If a live step stalls for more than **~8 s**, take its fallback and move on; don't wait on stage.

## 1. Employer invites a person and an agent (0:00–0:20)

- **Screen:** the company app (https://soapay.up.railway.app/), already logged in with the company wallet, on **Recipients**. The roster shows the prepared names (Before the demo, item 3). The welcome drop already arrived, so the wallet holds 1,000,000 mock USDC.
- **Clicks:** under **Invite employee**: Name `alex-meridian`, Salary per run `1.5`, Organisation `Meridian Labs` → **Sign and create link** → sign in the wallet → the QR code appears ("Link for **alex-meridian.soapay.eth**"). Leave the QR on screen for Alex's phone. Then the same form: Name `billing-agent`, Salary per run `1`, **Sign and create link** → **Copy link**. Both rows show **Invited (pending)**.
- **Say:** "Meridian Labs pays in USDC on Base. Paying a person or an agent starts the same way: we invite a name, not a wallet. Alex gets a QR code; our billing agent gets the same link, in chat."
- **Bounty:** none yet (the name is reserved on the API; ENSv2 lands in section 2).
- **Pre-staging:** company wallet logged in and vault unlocked; `alex-meridian` and `billing-agent` not yet claimed (check with `curl https://soapay.up.railway.app/api/names/alex-meridian` and `…/names/billing-agent`, which must both say `not_found`); `…/names/alex-demo` returns the fallback persona's name. `alex-demo` itself was claimed live on 2026-09-26, so it is only the fallback, never the live sign-up.
- **Fallback:** if signing an invite fails, use invites created the morning of the demo (a pending row has its own **Copy link**; the QR is only on the fresh card, so print the link as a QR beforehand).

> **Agent label:** the owner's brief said `invoice-agent`, but `invoice-agent.soapay.eth` is **already taken** (claimed live on 2026-09-26 by the CLI demo's agent, D-43), so the invite form would refuse it. This script uses **`billing-agent`** (free on 2026-09-26). Any unclaimed label works; say the one you pick.

## 2. The person signs up (0:20–0:55, phone)

- **Screen:** Alex's phone, mirrored.
- **Clicks:** scan the QR with the camera → the employee app opens on the invite: **Invited by Meridian Labs**, "Your pay name will be alex-meridian.soapay.eth" ([r01](demo-screens/r01-invite-welcome.png)) → **Create a new account** → **Save your recovery kit**: **Copy phrase** (into the password manager; faster than downloading on a phone) → tick "I saved my recovery kit somewhere safe" → **Continue** ([r02](demo-screens/r02-onboard-phrase.png)) → **Lock this device** → **Use Face ID / fingerprint (passkey)** → Face ID ([r03b](demo-screens/r03b-onboard-lock.png)) → **Publish your payment address** ("Passkey saved on this device", [r03c](demo-screens/r03c-onboard-passkey-saved.png)) → **Register for free** ([r04](demo-screens/r04-onboard-register.png)) → **Your pay name**, "Set by your invite." → **Continue** ([r05](demo-screens/r05-onboard-name.png)) → **Enable self-service key recovery** → **Set up with World ID** → World App opens: approve **Proof of Human** → back in the browser the name is claimed with World ID linked → **Share this one string with your employer**.
- **On the laptop:** within ~5 s the `alex-meridian` invite row disappears and `alex-meridian.soapay.eth` appears in **All recipients** (the company app polls every 5 s and resolves and pins the name).
- **Say (while tapping):** "Alex's keys are made on this phone and locked with Face ID. No wallet, no gas: we relay the registration. Alex gets `alex-meridian.soapay.eth`." At the World ID step: "And one tap of World ID, Proof of Human. That's what lets Alex recover their pay later if a key leaks. You'll see why in a minute."
- **Bounty:** ENSv2 (an on-chain subname issued at sign-up); World IDKit (a Proof of Human session linked at enrollment, proved again at recovery).
- **Pre-staging:** the phone has the World App installed, verified and logged in; the recipient URL is warm in the phone browser; Face ID set up; the password manager unlocked. World ID linked later normally needs a 72 h wait before it can back a key change; the testnet demo API sets `WORLD_ATTACH_COOLDOWN_SECONDS=0` (`attach_cooldown_seconds: 0` on `GET /api/worldid/config`), so a link made from Name settings works at once too. Keep the 72 h default anywhere real pay is at stake.
- **Fallback:** the sign-up is the slowest live step. If Register or the claim hangs past ~8 s (Sepolia read-after-write lag, the World App round trip), switch the mirror to the **backup phone profile** (`alex-demo`, the pre-onboarded fallback persona: already claimed live, World ID linked, already in the roster) and say "here's one I made earlier". Last resort: the pre-recorded sign-up clip.

## 3. What the name holds (0:55–1:10)

- **Screen:** Alex's phone, **Name** tab. Header `alex-meridian.soapay.eth`, "Your employer pays this name. It points to your current meta-address."; **Current keys** shows the `st:eth:0x…` meta-address; **Self-service recovery** shows the **World ID** badge: "World ID (Proof of Human) is linked to this name…" (that's the "linked" confirmation).
- **Optional (laptop, 5 s):** a terminal with the one-liner from Before the demo, item 9, printing `stealth st:eth:0x…` and `addr null` for `alex-meridian.soapay.eth`, then the name's own resolver on Sepolia Etherscan.
- **Say:** "This is what the name holds: one `stealth` record, the key the employer pays to. It lives on Alex's own ENSv2 resolver, and only Alex's key can change it. There's no `addr` record, on purpose: nobody can pay Alex at a fixed address that coworkers could watch."
- **Bounty:** ENSv2 (per-employee Permissioned Resolver, EAC on `stealth`, no `addr`).
- **Pre-staging:** the terminal command typed and ready (it takes ~3 s).
- **Fallback:** skip the terminal; the Name screen alone makes the point.

## 4. The agent joins (1:10–1:25)

- **Screen:** Claude Code on the laptop, with the Soapay MCP server installed (Before the demo, item 5).
- **Clicks:** type "Join Meridian Labs payroll with this invite: " and paste the link copied in section 1 → Claude calls **`create_agent_identity`** with `invite` → it reports `billing-agent.soapay.eth`, `created: true`, the org `Meridian Labs`, and its records (`agent-context`, the ENSIP-26 entry point). Switch to the company app: the `billing-agent` row has flipped from **Invited (pending)** to a recipient (within ~5 s).
- **Say:** "The agent got the same link. It registers its own keys, claims `billing-agent.soapay.eth` with an ENSIP-26 agent record next to its `stealth` record, and the company sees it join, exactly like Alex."
- **Bounty:** ENSv2 (the same name, plus ENSIP-26 agent records set at issuance).
- **Pre-staging:** the MCP server built from this branch (the `invite` parameter is new, D-56); a fresh agent mnemonic; Claude Code open in a clean session.
- **Terminal alternative (no LLM):** `pnpm demo:agent join`, paste the link at the prompt → the same `create_agent_identity` call through the same MCP server, printing the name, the ENSIP-26 records and the Etherscan link (see [demo-desktop.md](demo-desktop.md), "Agent beats from the terminal").
- **Fallback:** a **pre-joined agent**: if the tool errors or the model dithers, say "it joined before we came on" and show a second agent label joined in rehearsal (already in the roster). The row flip is the point; don't debug on stage.

## 5. Disbursement, behind the scenes (1:25–1:55)

- **Screen:** company app.
- **Clicks:** **Start pay run** → Run label `September payroll` → **Resolve names** (each row: "Verified · N fresh addresses"; alex-meridian and billing-agent included, [s08](demo-screens/s08-sender-resolved.png)) → **Review** → the headline reads "*X USDC to N people, on M fresh addresses.*" with "On chain: M payments of about 0.50 USDC to M strangers." and the **First fresh address** column ([s09](demo-screens/s09-sender-review.png)) → **Sign and send** (smart wallet, one signature) → the run page → its Basescan link: one transaction, many unrelated addresses. Then Alex's phone: **Payments** → **Rescan** → **Pay runs** → **Two views** on the newest run: **Coworker view** (every line, owner unknown) → toggle **My view** (Alex's lines highlighted, "3 of M lines are yours").
- **Say (read the headline):** "Ten people and an agent, M fresh addresses, one signature. On Basescan it's one transaction to M strangers." On the phone: "This is what a coworker sees: the whole batch, nobody's name. And this is Alex's view: the same transaction, only Alex's key lights up Alex's lines."
- **Bounty:** none directly: this is the product claim. (ENSv2 underneath: every name is re-resolved and checked against its pin.)
- **Pre-staging:** roster of 10 or more (item 3); Settings chunk `0.5`; a smart-wallet company account so the run is one prompt (with a plain EOA it's **Approve and send**: two prompts, approve then pay, and it needs a little Base Sepolia ETH); Basescan warm in a tab.
- **Fallback:** if the wallet or RPC stalls past ~8 s: "here's the same run from rehearsal" → the rehearsal run's Basescan tab, and the phone's **Two views** on that earlier run. If the phone's receipt read stalls ("Reading the transaction's logs…"), the company app's run page shows the same list under **What coworkers see**.

## 6. The agent spends (1:55–2:25)

- **Screen:** Claude Code.
- **Clicks:** "What was I paid? Then send 0.5 USDC to alex-meridian.soapay.eth." → the agent calls **`scan`** ("the pay run has M lines; 2 are mine", real on-chain balances) → **`spend`** returns a plan (from one stealth address, to a fresh address for Alex, sponsored gas) → reply "yes, confirm" → **`spend`** with the planId → a Basescan link. Open the agent's source stealth address on Basescan: **0 ETH**; the userOp's gas was paid by the sponsoring paymaster.
- **Terminal alternative (no LLM):** `pnpm demo:agent spend 0.5 alex-meridian` → `scan` ("N lines in this pay run; 2 are mine"), the `spend` plan, a confirm prompt, the Basescan link and "source address … ETH: 0".
- **Say:** "The agent finds its two lines among everyone's, and pays Alex from one of them. Look at that address: zero ETH. It never needed gas; a paymaster sponsored it. On mainnet, Circle's paymaster takes the fee in USDC. And Alex receives it at yet another fresh address."
- **Bounty:** none (product claim; ENSv2 again: the agent pays a *name*).
- **Pre-staging:** the agent's salary is `1` with a `0.5` chunk, so it gets exactly 2 lines and 0.5 USDC is one line from one address (one userOp, no consolidation). Caps default to 5 USDC per call. The API indexer is healthy (`GET /api/health`).
- **Fallback:** if the new run's announcements aren't indexed yet, the agent still holds its lines from the rehearsal run, so the scan still works; say "including last run's". If the bundler or paymaster stalls: the recorded gasless agent spend ([0x35172021…](https://sepolia.basescan.org/tx/0x3517202141e4f1ad9849aa40f04ec3d7e332bd8d38a72d991d64d1e4b4d3f3e2)). If the model errors, the pre-recorded clip.

## 7. Recovery: the real World ID moment (2:25–2:55)

- **Say (setup):** "Say Alex's recovery phrase leaked."
- **Clicks (phone):** **Name** → **Rotate to new keys** → "You'll confirm with World ID. Your employer's app then accepts the change automatically." → **Continue to World ID** → **Prove it's still you** → **Confirm with World ID** → World App: Proof of Human → **Keys rotated**: "Your name points at the new keys, with a World ID attestation."
- **Clicks (company app):** **Start pay run** → **Resolve names** (or **Recipients** → **Re-verify all**) → `alex-meridian.soapay.eth`: **Verified** with the **Re-verified by World ID** pill (the owner's "new keys, verified by World ID ✓"); the run accepts it.
- **Say:** "Same human, proven in the World App, so the company's app follows the new keys by itself. And a thief?"
- **Clicks (terminal, then company app):** the terminal shows `pnpm demo:attacker sam-demo` (run live at the start of section 6 in a second terminal, ~15 s, or beforehand): "Record rewritten on-chain ✓. Attestation: refused (…). At the next pay run, the company app will block sam-demo's line." Back in the company app, **Resolve names** again → `sam-demo.soapay.eth`: **Blocked · record changed** ([s13](demo-screens/s13-sender-rotation-status.png) shows both pills).
- **Say (close of the beat):** "The thief had sam's phrase, so they could rewrite sam's ENS record. But they're not sam, so there's no World ID proof, and the company's app refuses to pay the new keys. World ID protects future pay: a thief can rewrite the record, but the money doesn't follow."
- **Bounty:** World IDKit (Proof of Human session, same-session recovery, EIP-712 attestation enforced by the payer's app).
- **Pre-staging:** alex's World ID linked at sign-up (section 2), so no cooldown; the attacker command typed in a second terminal; one full rotation rehearsed on `alex-demo`; `sam-demo` in the roster and pinned **before** it is hijacked.
- **Fallback:** World App flaky past ~8 s: cancel, switch to `alex-demo` (rotated in rehearsal) and show its **Re-verified by World ID** pill, or the recorded rotation clip. Attacker slow: it was also run in rehearsal, so show its Etherscan link and the company app's blocked pill ([s13](demo-screens/s13-sender-rotation-status.png) as a screenshot of last resort).

**When to hijack sam.** If sam is hijacked before section 5, sam's line shows **Blocked · record changed** during the pay run and spoils the reveal (the run still goes ahead without sam). Best: start `pnpm demo:attacker sam-demo` in the second terminal as the pay run is signed (section 5) or as section 6 starts; it finishes in ~15 s, well before section 7. If you must run it beforehand, just don't comment on sam's line in section 5.

## 8. Closing line (2:55–3:00)

- **Say:** "One name, a fresh address every payday, for people and agents. Coworkers see the batch, not the salaries, and only the human can move the pay."

## Before the demo

The day before:

1. **Company wallet:** a Coinbase Smart Wallet (one-signature pay run, gas-sponsored through the API's paymaster) logged in to the company app on the demo laptop; the vault created ("Use a device key (no passphrase)"). The **welcome drop** (1,000,000 mock USDC) arrives on first login. A plain EOA works too, but needs a little Base Sepolia ETH and two prompts.
2. **Settings:** chunk `0.5` USDC, **Denominated payouts** on.
3. **Roster of 10 or more names, pinned** (Recipients → Add by name → **Resolve and pin**), with salaries between 0.5 and 2 USDC. It must include **`sam-demo`** and, after the live sign-up, **`alex-meridian`** and **`billing-agent`** join through their invites. Live names you can use: `sam-demo`, `dividend-ana`, `dividend-ben`, `dividend-cleo`, `pay392111`, `pay730021`, `invoice-agent`, `mcp-agent-7c1e`, plus the backups `alex-demo` and a pre-joined second agent. Run **Resolve names** once to check that every row is **Verified**. Ten or more people also keeps the small-team warning off the Review page.
4. **sam-demo:** `pnpm demo:setup-recovery` (idempotent; claims `sam-demo.soapay.eth` through the live API; the phrase stays in the git-ignored `scripts/.demo-recipients.local.json`). Rehearse the whole hijack without a browser with `pnpm demo:recovery-check` (≈ 2 min, live txs, restores at the end). `DEMO_DRY=1 pnpm demo:attacker sam-demo` shows the plan without sending.
5. **MCP in Claude Code**, built from this branch (the `invite` parameter, D-56): `pnpm install && pnpm build`, then

   ```bash
   claude mcp add soapay \
     -e API_URL=https://soapay.up.railway.app/api \
     -e RPC_URL=https://sepolia.base.org \
     -e ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
     -e AGENT_MNEMONIC="<fresh 12 words, never shown on screen>" \
     -e AGENT_PAYER_PRIVATE_KEY=<fresh key> \
     -e STATE_DIR=$HOME/.soapay-mcp-demo \
     -- node /abs/path/apps/mcp/dist/index.js
   ```

   For the terminal version of sections 4 and 6 instead: `pnpm demo:agent init` (writes a fresh phrase to the git-ignored `scripts/.demo-agent.local.env`, never printed), then `pnpm demo:agent status`. Its payer is `contracts/.env`'s deployer key unless `AGENT_PAYER_PRIVATE_KEY` is set there.

   Use a **fresh** mnemonic (the one behind `invoice-agent` already owns a name). Ask the agent to call **`get_test_funds`** once, so its payer holds test USDC (it only needs it for `pay`; spends from stealth addresses are sponsored). Keep the env out of the mirrored screen.
6. **Backups made the same way as the live flow:** `alex-demo` (phone profile 2), the pre-onboarded fallback persona: it is **already claimed live** (so it can't be the live sign-up; that's `alex-meridian`), and must have **World ID linked** (link it from Name settings in rehearsal if it isn't) and be in the roster; a second agent joined through an invite with a second MCP config (the "pre-joined agent").
7. **One full rehearsal on the live stack:** invite → sign-up (on `alex-demo`) → pay run → agent scan and spend → rotation with World ID → `pnpm demo:attacker sam-demo` → **Blocked** → `pnpm demo:attacker sam-demo --restore` → Resolve names shows sam **Verified** again. Record the rehearsal (clips for every fallback). The rehearsal run also leaves the agent and Alex with lines from an earlier run.
8. **World ID:** the API runs `WORLD_ENV=production` with **Proof of Human** (D-51, D-54): `curl https://soapay.up.railway.app/api/worldid/config` shows `"credential":"proof_of_human"`. The World App on Alex's phone is verified. The same World ID can link `alex-demo`, `alex-meridian` and other demo names: each name stores the session it was linked with, and one session may back several names (D-59). The API must run on the session-capable RP (`WORLD_RP_ID` = `rp_25e1826d2548c1d9`); names linked before D-59 (under D-58's nullifier) count as unlinked, so re-link them in rehearsal.
9. **Terminal one-liner for section 3** (from `packages/sdk`, where viem is installed):

   ```bash
   node -e 'import("viem").then(async({createPublicClient,http})=>{const{sepolia}=await import("viem/chains");const c=createPublicClient({chain:sepolia,transport:http("https://ethereum-sepolia-rpc.publicnode.com")});const n="alex-meridian.soapay.eth";console.log("stealth",await c.getEnsText({name:n,key:"stealth"}));console.log("addr",await c.getEnsAddress({name:n}));console.log("resolver",await c.getEnsResolver({name:n}))})'
   ```

   Checked on `sam-demo.soapay.eth` (2026-09-26): prints the `st:eth:0x…` record, `addr null`, and the name's own resolver address, which opens on Sepolia Etherscan.

Fifteen minutes before:

- Phones charged, Do Not Disturb on, screen mirroring for the laptop **and** the phone tested on the venue's display.
- Tabs open and warm: company app, Basescan (it has a Cloudflare check; pass it by hand), Sepolia Etherscan, the fallback clips.
- `curl https://soapay.up.railway.app/api/health` answers; `alex-meridian` and `billing-agent` are still `not_found` (`curl https://soapay.up.railway.app/api/names/<label>`) and `alex-demo` resolves; the company wallet's welcome drop is visible.
- `pnpm demo:agent status` answers in the agent terminal (no name yet, 0 USDC; the join comes in section 4).
- The attacker command typed in the second terminal (not run, unless you chose to run it beforehand).
- Claude Code open in a clean session with the Soapay MCP connected (`/mcp` lists `soapay`).
- **No deploys during the demo.** Pushes to `main` deploy automatically (D-46); a restart of the API can interrupt a name claim mid-flight. Freeze merges to `main` an hour before.

After the demo: `pnpm demo:attacker sam-demo --restore`. The agent pinned Alex's old keys in section 6, so a later agent payment to Alex fails with `pin_changed` until the operator removes the pin from `$STATE_DIR/state.json` (by design).

## Risks and fallbacks

| Risk | Likelihood | Fallback |
| --- | --- | --- |
| Live sign-up is slow (six steps on a phone, Sepolia lag after Register) | High | Switch the mirror to `alex-demo`; last resort the sign-up clip |
| World App round trip flaky (sign-up or rotation) | Medium | `alex-demo` (World ID linked, rotated in rehearsal) or the recorded clip; never retry twice on stage |
| Invite signing or the invite poller slow | Low | Invites created that morning; the row flips within one 5 s poll, so keep talking |
| Agent errors (model asks questions, tool error, `label_taken`) | Medium | The pre-joined agent; for the spend, the recorded gasless spend tx; the clip |
| Wallet prompt or Base Sepolia stalls on the pay run | Medium | The rehearsal run's Basescan tab and its **Two views** on the phone |
| Basescan slow or Cloudflare-gated | Medium | Pre-warmed tabs; the company app's **What coworkers see** panel shows the same lines |
| Paymaster or bundler down (agent spend) | Low | Recorded spend tx; `GET /api/health` beforehand |
| Attacker script slow or RPC error | Low | Run it beforehand; show its Etherscan link and the **Blocked · record changed** pill |
| An API deploy restarts mid-claim | Low if frozen | Merge freeze (D-46); re-run the tool (idempotent) |
| `register_rate_limited` on the agent join (the API allows 3 registrations per IP per hour) | Low | Don't rehearse registrations from the venue network in the last hour; the pre-joined agent |

Keep a slide with screenshots in script order as the last-resort deck (see the screenshot list below).

## What the pitch minute covers

So the live demo doesn't have to:

- **The problem:** a payroll batch on a public chain leaks every salary to every coworker; a wallet address is a public bank statement.
- **The threat model:** the adversary is a coworker in the same batch who knows their own line and likely your main wallet. The employer is trusted. Out of scope for v1: chain analysts and RPC linkage.
- **What Soapay is:** one ENS name per person or agent, a fresh stealth address per payment (ERC-5564 / ERC-6538), one custom contract that holds nothing.
- **Pluggable:** everything in the apps comes from `@soapay/sdk`; the same rails run a CLI (`soapay distribute` for dividends, grants), the MCP server for agents, and the `examples/`. Mention the recorded CLI run (appendix) rather than showing it.
- **Roadmap / mainnet:** the compliant exit through Privacy Pools (built and run end to end with Circle USDC on testnets, hidden on the mock-USDC demo), the Circle paymaster taking gas in USDC on Base mainnet, per-request (x402-style) agent payments as a cost-vs-privacy question.

## Screenshots

In [`demo-screens/`](demo-screens/). Referenced above only where they still match the current build (the names and amounts differ; the screens are the same): r01–r05, r03b, r03c, s08, s09, s13.

**Need retaking** (not retaken here), at 1280×800 with `?motion=off`, ideally on the live stack with the demo's names:

- **r06** (Recovery step): says "Selfie Check"; now "Proof of Human with World ID" (D-54).
- **r08, r08a, r08b, r08c** (Payments, Pay runs, Two views): the nav still shows **Convert** and **Exit** (removed / hidden, D-52, D-53).
- **r19, r20, r21, r22** (Name, rotation): Convert/Exit in the nav, and "Selfie Check" copy.
- **s05** (invite link card): matches, but retake with `alex-meridian` / Meridian Labs for the deck.
- **s01**: check against the current landing copy before using.
- New shots wanted: the agent joining in Claude Code (section 4), the agent's scan and spend (section 6), the section 3 terminal output, the attacker summary (section 7).

**Removed** (outdated beats; the docs site keeps its own copies in `apps/docs/src/assets/screens/`): r09–r15 (web Send, guard, exit), r16–r18 (Convert), `beat4-pluggable-live.*` (kept as the CLI recording for the pitch).

## Appendix: links and live references

| What | Link |
| --- | --- |
| Company (sender) app + landing | https://soapay.up.railway.app/ |
| Employee (recipient) app | https://soapay.up.railway.app/app/ |
| API | https://soapay.up.railway.app/api (`/health`, `/names/:label`, `/worldid/config`) |
| Mock USDC (Base Sepolia) | https://sepolia.basescan.org/address/0x028D969c20b740582428f5043954c380686214Bb |
| `StealthDisperse` (Base Sepolia) | https://sepolia.basescan.org/address/0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA |
| Canonical ERC-5564 Announcer | https://sepolia.basescan.org/address/0x55649E01B5Df198D18D95b5cc5051630cfD45564 |
| Live pay run (2 stealth addresses, 3.0 + 2.5 USDC) | https://sepolia.basescan.org/tx/0x24f23d610d1917905d3896e282243b07a038afb2bf266f94f11f31ea9e5b492d |
| Live gasless 7702 spend, sponsored (mock USDC) | https://sepolia.basescan.org/tx/0x15ea6dcd7f489ff829365c6e9dfef0b86859aba4cdc97e0a010fa761e418265c |
| CLI + agent run: 12 lines incl. the agent (D-43) | https://sepolia.basescan.org/tx/0xf7fb06dfa47313fbeab80fe6e01cc0d003d38d221819ad35d09bfcad9051ce0e |
| The agent's gasless spend from that run | https://sepolia.basescan.org/tx/0x3517202141e4f1ad9849aa40f04ec3d7e332bd8d38a72d991d64d1e4b4d3f3e2 |
| Agent name with ENSIP-26 records | `mcp-agent-7c1e.soapay.eth` (`agent-context`, `agent-endpoint[web]`) |

**CLI recording (pitch only):** `DEMO_REPLAY=1 scripts/demo-pluggable.sh` replays the recorded "plug it into anything" run ([`demo-screens/beat4-pluggable-live.txt`](demo-screens/beat4-pluggable-live.txt)); `DEMO_DRY=1` plans without sending.

**Exit (roadmap evidence, not shown on the testnet demo):** the 2026-09-26 live exit with Circle USDC: [pay](https://sepolia.basescan.org/tx/0xbd9d0001b4fe5fbee969003921b43a82608e7e3d0748a3fcd347f33244a3799b) → [burn](https://sepolia.basescan.org/tx/0x78fa2c713458f30879096a4d79a024f4fc0eab55aceffc8789111beaf19b6c89) → [mint](https://sepolia.etherscan.io/tx/0x5feec0c529b0b424b98c3b4c28f00191d20e7ca25b52b5d8d41627e7779436ab) → [deposit](https://sepolia.etherscan.io/tx/0xa7c6ff5f59c0c231b53df82859fca712798d398e9a907aefba778a5495d013e0) → [direct withdrawal](https://sepolia.etherscan.io/tx/0xed9235c87f7643bde048cd9e29c8abebe989a64016a628c85faa7ed5724fc672). Details: docs/testnet-deployment.md.

**Recovery scripts (D-55):** `scripts/demo-setup-recovery.ts`, `scripts/demo-attacker.ts` (`--restore`, `DEMO_DRY=1`), `scripts/demo-recovery-check.ts`. Env: `API_URL` (default the Railway API), `ENS_RPC_URL`, `RPC_URL`, `SOAPAY_DEMO_FILE` (the phrase file), `SOAPAY_ENV_ROOT` (where the git-ignored `contracts/.env` and `apps/api/.env` live, for the stolen registrant's gas top-up). Nothing prints a phrase or a key. Honest line if asked: World ID protects **future** salary; a stolen phrase can still spend what sam already received, so move funds and rotate as soon as a leak is suspected.

**Offline fallback:** both apps in mock mode (`VITE_MOCK_API=1` / `VITE_MOCK_ENS=1`; `pnpm --filter @soapay/recipient dev:mock`). The mock company wallet can't sign a pay run, so the live pay run has no offline equivalent: use the recorded tx.

## Cue card: the 2:45 version for the stage

The short version of the script above. The full script has the pre-staging, exact labels and every fallback. Rule: if a live step stalls for more than ~8 s, take the fallback and keep talking.

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

### 1. Invite (0:00–0:15) · laptop, Recipients

- **Do:** Invite employee `alex-demo` → **Sign and create link** → QR. Same form for `billing-agent` → **Copy link**.
- **Say:** "Meridian pays in USDC on Base. We invite a *name*, not a wallet: Alex gets a QR, our billing agent gets the same link in chat."

### 2. Alex signs up (0:15–0:45) · phone

- **Do:** scan QR → **Create a new account** → **Copy phrase**, tick, **Continue** → passkey (Face ID) → **Register for free** → **Continue** → **Set up with World ID** → approve Proof of Human in the World App → **Share this one string…**
- **Say:** "Keys are made on the phone and locked with Face ID. No wallet, no gas. Alex gets `alex-demo.soapay.eth`. One World ID tap links a real human to this name: that's what lets Alex recover later."
- **Laptop:** Alex's row appears within ~5 s.
- **Fallback:** switch to `alex-backup` ("one I made earlier").

### 3. What the name holds (0:45–0:55) · phone, Name tab

- **Say:** "The name holds one `stealth` record on Alex's own ENSv2 resolver; only Alex's key can change it. No `addr` on purpose, so coworkers can't watch a fixed address."

### 4. Agent joins (0:55–1:10) · Claude Code

- **Do:** "Join Meridian Labs payroll with this invite: ‹link›" → `create_agent_identity` → `billing-agent.soapay.eth`.
- **Say:** "Same link. The agent makes its own keys and claims its name, with ENSIP-26 agent records. The company sees it join, just like Alex."
- **Fallback:** the pre-joined agent.

### 5. Pay run (1:10–1:40) · laptop, then phone

- **Do:** **Start pay run** → **Resolve names** → **Review** → **Sign and send** → Basescan. Phone: **Payments** → **Pay runs** → **Coworker view** ↔ **My view**.
- **Say:** "One signature, one transaction, many fresh addresses. Every name is checked against its pinned keys. This is what a coworker sees: the whole batch, no names. And Alex's view: only Alex's key lights up Alex's lines."
- **Fallback:** the rehearsal run's Basescan tab.
- *(Start `pnpm demo:attacker sam-demo` in the second terminal now.)*

### 6. Agent spends (1:40–2:05) · Claude Code

- **Do:** "What was I paid? Then send 0.5 USDC to alex-demo.soapay.eth." → `scan` → `spend` plan → "yes, confirm" → Basescan.
- **Say:** "The agent finds its lines among everyone's and pays Alex by name. The sending address holds zero ETH; gas is sponsored. On mainnet, Circle's paymaster takes it in USDC."
- **Fallback:** the recorded gasless spend tx.

### 7. Recovery and the thief (2:05–2:40)

- **Say:** "Say Alex's recovery phrase leaked."
- **Phone:** **Name** → **Rotate to new keys** → **Continue to World ID** → **Confirm with World ID** → **Keys rotated**.
- **Laptop:** **Resolve names** → alex-demo: **Re-verified by World ID**.
- **Say:** "Same human, so the company's app follows the new keys by itself. And a thief?"
- **Terminal + laptop:** the attacker summary → **Resolve names** → sam-demo: **Blocked · record changed**.
- **Say:** "The thief had sam's phrase and rewrote sam's record. But they're not sam: no World ID proof, so the money doesn't follow."
- **Fallback:** `alex-backup`'s rotated pill; the attacker's Etherscan link.

### 8. Close (2:40–2:45)

- **Say:** "One name, a fresh address every payday, for people and agents. Coworkers see the batch, not the salaries, and only the human can move the pay."

### Flows worth knowing if asked

- **Keys:** the recovery phrase derives a spending key and a viewing key. The ENS `stealth` record holds only the two public keys. Each payment's address comes from those plus the sender's one-time key, so only Alex can find and open it.
- **Pinning:** the company app resolves each name once and pins its keys. A changed record is paid only with a World ID attestation or the employer's re-approval.
- **World ID:** a Proof of Human *session* is linked at sign-up; a rotation must prove the same session. It's bound to the change through the single-use RP nonce, and replays are refused. Linking later has a 72 h wait by default (set to 0 on the testnet demo).
- **Gasless spend:** each stealth address is upgraded to a Simple7702Account on first spend, and a paymaster covers gas (Pimlico on testnet, Circle's USDC paymaster on mainnet).
- **What's out of scope:** chain analysts and RPC linkage. The adversary is a coworker; the employer is trusted.
- **Honest caveat:** World ID protects *future* pay. A leaked phrase can still spend what's already received, so rotate and move funds quickly.
