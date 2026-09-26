# Demo flow: 3 minutes, on CK's UI

A live script for the Soapay demo. It follows CK's screens in the order they present themselves: the sender app (landing → login → vault → Recipients → Pay run → Review → History), then the recipient app (invite → Keys → Lock → Register → Name → Recovery → Share → Payments → Send → Exit → Convert → Name). No step below needs a screen that doesn't exist, except the one visual proposed in "Beat 4".

Every screen and button label below was clicked through on 2026-09-26: both apps in mock mode (`VITE_MOCK_API=1` / `VITE_MOCK_ENS=1`), plus the live landing pages at https://soapay.up.railway.app. The screenshots are in [`demo-screens/`](demo-screens/) (`s*` = sender, `r*` = recipient, `live-*` = Railway).

**The story in one line:** a public payroll batch leaks everyone's salary to every coworker. Soapay gives each employee one name and pays a fresh address every time, so a coworker sees the batch but can't tell which line is whose.

## Links to have open

| What | Link |
| --- | --- |
| Recipient app (live) | https://soapay.up.railway.app/ |
| Sender app (live) | https://soapay.up.railway.app/sender/ |
| Live pay run (StealthDisperse → 2 stealth addresses, 3.0 + 2.5 USDC, 2 Announcements; checked by RPC) | https://sepolia.basescan.org/tx/0x24f23d610d1917905d3896e282243b07a038afb2bf266f94f11f31ea9e5b492d |
| Live gasless 7702 spend (gas paid in USDC by the Circle paymaster) | https://sepolia.basescan.org/tx/0x1167b83dfab7476ac32b286b890fdcfdba396766d9389778568d949cbffc1bae |
| `StealthDisperse` on Base Sepolia | https://sepolia.basescan.org/address/0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA |
| Canonical ERC-5564 Announcer | https://sepolia.basescan.org/address/0x55649E01B5Df198D18D95b5cc5051630cfD45564 |
| ENSv2 names paid live | `pay392111.soapay.eth`, `pay730021.soapay.eth` (resolve with the one-liner in `docs/bounty-integrations.md`) |

Basescan is behind a Cloudflare check that a headless browser can't pass. Open these tabs by hand in the demo browser beforehand, and keep them logged in and warm.

## Pre-demo setup (the day before, then 15 minutes before)

**Test USDC budget: about 30 USDC in total** (Circle's faucet gives 20 per address every 2 hours; top up with `scripts/fund-usdc.sh`, see docs/testnet-deployment.md, "Funding"). On Base Sepolia the apps already default to testnet amounts (D-47): 5 USDC chunks, small example salaries, and a confirmation above 50 USDC per run.

| What | Test USDC |
| --- | --- |
| Exit leg for "Me" (one line, step 6) | 18 |
| "Me"'s 2–3 earlier small runs (step 4) + the live pay run (Beat 3) | about 8 |
| Beat 4b dividend (`DIVIDEND_TOTAL`) | 0.5 |
| Send (Beat 5) and Convert (Beat 6) come out of what "Me" was paid | 0 extra |
| Paymaster gas, paid in USDC | about 1 |

1. **Fix the landing overclaim first** (see Gaps). Otherwise the first screen the judges read says something false.
2. **Employer wallet:** a plain EOA on Base Sepolia with about 30 USDC (`scripts/fund-usdc.sh <address>`, two faucet drips 2 hours apart, or recycle what earlier rehearsals sent to wallets we control) and a little ETH. The sender then takes the `StealthDisperse` path ("Approve the exact total, then 1 StealthDisperse payment"). The mock demo wallet can't sign, so the live pay run needs this real wallet.
3. **Sender vault:** log in and create the vault ("Use a device key (no passphrase)"). Roster: at least 10 names. With fewer than 10 the Review page shows the small-team warning (correct, but it takes airtime). Keep **Denominated payouts** on. Give the roster small salaries (0.5–1.5 USDC each, about 8 USDC for ten people) and set Settings → chunk to `0.25`, so the run is a busy tx of about 40 equal lines on a testnet budget. (The testnet default chunk is 5 USDC; with sub-5 salaries every line would be a remainder.)
4. **Two recipient profiles**, in two browser profiles:
   - **"Me" (Jordan):** fully onboarded with a World ID Selfie Check session attached at enrollment (or attached 72 h earlier; the cooldown applies), labelled main wallet under Labels, and already paid by 2–3 earlier runs, so Payments shows several addresses from the Acme payer.
   - **"New hire":** a fresh invite link opened and left on the first onboarding screen, or on the Recovery step (see Beat 2).
5. **Pre-generated invite:** create it now under Recipients → Invite employee → **Sign and create link**. Keep the link and its QR.
6. **Pre-approved exit leg:** on "Me", run one leg the day before under Exit (**Withdraw round amounts** on; **Wait a random delay after approval** off for the demo leg). A leg needs at least **16.40 USDC** on one stealth address (the planner shows the minimum and how much a short address needs); pay 18 to be safe, as **one line**: a run to "Me" alone with **Denominated payouts** off (small chunks would split it below the minimum). The scripted live run and its funding status are in docs/testnet-deployment.md, "Live exit": as of 2026-09-26 it is blocked on 5.80 test USDC for the deployer, so there are no live tx links yet; add them to Beat 5 once it has run. If the leg is still queued in its timing window, **Start now** on the leg starts it at once. The ASP approval can take hours, so it has to be approved before you go on stage. The Exit screen then lists it under **Finished exit** with its Basescan/Etherscan step links.
7. **World ID:** the API runs `WORLD_ENV=staging` (the simulator). Open the simulator on a second device or tab and do one full rotate end to end beforehand (it hasn't been run live yet; see bounty-integrations "Before judging").
8. **Fallback deck:** the screenshots in `demo-screens/` in slide order, plus a mock-mode build of both apps on localhost (the recipient's `pnpm --filter @soapay/recipient dev:mock` runs the whole flow offline, exit included, in about 35 s per leg).

## The script

Total 3:00. Time is the budget for each beat; the clicks are exactly CK's labels.

### Beat 1: The problem (0:00–0:15) · sender landing

- **Screen:** sender `/sender/` landing ([s01](demo-screens/s01-sender-landing.png)).
- **Clicks:** none yet.
- **Say:** "Pay your team in USDC on-chain and every coworker can read everyone's salary off the batch. A wallet address is a public bank statement."
- **Bounty:** none (context).
- **Fallback:** none needed.

### Beat 2: One name, a fresh address per payment (0:15–0:50) · Recipients → invite → onboarding · ENSv2

- **Clicks (sender):** **Login with wallet** → pick the wallet ([s02](demo-screens/s02-sender-login.png)) → **Unlock on this device** → you land on **Recipients** ([s06](demo-screens/s06-sender-recipients.png)). Under **Invite employee**: Name `jordan`, Salary per run, Organisation → **Sign and create link** ([s05](demo-screens/s05-sender-invite-link.png)). Point at the row: **Invited (pending)**.
- **Clicks (recipient, the "New hire" profile, pre-opened on the invite link):** "Invited by … Your pay name will be jordan.soapay.eth" ([r01](demo-screens/r01-invite-welcome.png)). The stepper reads Keys · Lock · Register · Name · Recovery · Share. Don't do the recovery kit and lock live ([r02](demo-screens/r02-onboard-phrase.png) shows the old write-down screen; since D-44 the Keys step is "Save your recovery kit": Download / Copy phrase / Show words, then a checkbox, no word quiz; [r03b](demo-screens/r03b-onboard-lock.png)): pre-stage the profile at **Register** and click **Register for free** ([r04](demo-screens/r04-onboard-register.png)) → **Continue** on the name ([r05](demo-screens/r05-onboard-name.png)) → on Recovery, **Skip and claim jordan.soapay.eth** (World ID is shown later) ([r06](demo-screens/r06-onboard-worldid.png)) → Share: "Share this one string with your employer" ([r07](demo-screens/r07-onboard-share.png)).
- **Say:** "The employer invites a name, not a wallet. The employee's browser makes the keys, we pay the gas to publish them, and they get `jordan.soapay.eth`, an ENSv2 subname with its own resolver that only Jordan can repoint. There's no `addr` record, so nobody can pay a static address by mistake."
- **Bounty:** ENSv2 (per-employee Permissioned Resolver, EAC on `stealth`, `addr` unset).
- **Pre-staged:** the invite link, and the new-hire profile parked at Register.
- **Fallback:** if Register or the name claim hangs on Sepolia (read-after-write lag), go to the pre-onboarded "Me" profile and show **Name** (jordan.soapay.eth plus its meta-address, [r19](demo-screens/r19-name.png)). The Recipients row flips to **Active** by itself once the claim lands (it polls every 5 s).

### Beat 3: The pay run (0:50–1:20) · Pay run → Review & sign → History

- **Clicks:** **Start pay run** (or the **Pay run** tab) ([s07](demo-screens/s07-sender-payrun.png)) → Run label `September payroll` → **Resolve names** (each row shows "Verified · N fresh addresses", [s08](demo-screens/s08-sender-resolved.png)) → **Review** ([s09](demo-screens/s09-sender-review.png)) → **Approve and send** → wallet: approve, then pay → the run page, then the **History** tab ([s11](demo-screens/s11-sender-history.png)).
- **Say (read the Review headline aloud):** "*8 USDC to 10 people, on 40 fresh addresses. On chain this looks like 40 payments of about 0.25 USDC to 40 strangers.*" (the figures are the testnet roster from setup step 3; read whatever the headline says) "Each name is re-checked against the key we pinned, and it's one transaction that pays and announces every line."
- **Bounty:** ENSv2 (resolve-and-pin on every run).
- **Pre-staged:** a funded employer EOA; the roster already resolved once.
- **Fallback:** Base Sepolia confirmations normally take a few seconds. If the wallet or the RPC stalls for more than about 10 s, say "here's the same run from earlier" and switch to the live pay-run tx tab. Don't wait on stage. If the approval fails, the run page shows "Not sent: the approval didn't go through" plus **Retry unpaid lines** ([s10](demo-screens/s10-sender-send-attempt.png)); retry once, then fall back.

### Beat 4: What a coworker sees vs what I see (1:20–1:50) · the core moment

- **Screen:** "Me" on **Payments**, scrolled to **Pay runs** (D-41). One row per pay-run transaction that paid me: block, payer, how many of my lines are in it, and the tx.
- **Clicks:** **Rescan** (so Beat 3's lines appear) → **Two views** on the newest run. It opens on **Coworker view**: every line of that transaction as the chain shows it (short stealth address, amount from the USDC Transfer log, owner "unknown"), under "This is everything anyone can see on-chain: 50 payments totalling … USDC from 0x… in one transaction". Flip the toggle to **My view**: the same list, my lines highlighted **You**, and the honest count, "6 of 50 lines are yours (2,750.00 USDC)". **View on Basescan ↗** opens the same tx (live only; mock mode has no explorer link).
- **Say:** "This is my coworker's view: fifty payments to strangers, rebuilt from the transaction's own logs. They know their own lines, and that's all. Now my view: the same transaction, and only my viewing key lights up my six lines. Nothing else about the other forty-four changes."
- **Bounty:** none directly. This is the product claim (PRD Goal 2).
- **Pre-staged:** "Me" already paid by 2–3 runs from the Acme payer (mock mode fabricates three runs of 50 lines each, 44 of them coworkers' 500 USDC chunks: mock fixtures, not test USDC).
- **Fallback:** if the RPC stalls reading the receipt ("Reading the transaction's logs…" for more than a few seconds), open the pre-warmed Basescan tab for the live pay run (2 lines: 3.0 and 2.5 USDC). The sender's run page shows the same list under **What coworkers see**, with names beside it only on the employer's screen.

### Beat 4b: Plug it into anything (terminal, 10–20 s) · CLI + MCP, live on Base Sepolia

- **Pitch line:** "Soapay doesn't care who gets paid: a person or an agent gets the same name, the same privacy, the same exit."
- **What it shows:** Soapay is building blocks, not just an app. The rails are payer- and payee-agnostic: anyone (an employer, a company paying dividends, a DAO, an agent) pays anyone (a person or an agent) at a fresh address derived from their spending and viewing keys. Payroll is the first product; dividends and grants run on the same rails (`--preset dividend`, `--preset grant`).
- **The clip** (one command, `scripts/demo-pluggable.sh`, about 35–40 s live; show steps 2 and 4, or play it back at 2x):
  1. An AI agent claims `invoice-agent.soapay.eth` through the MCP server (ENSIP-26 `agent-context` written at issuance). Idempotent: after the first run it prints "already this agent's".
  2. **One** revenue-share run pays three people (`dividend-ana|ben|cleo.soapay.eth`), a raw meta-address and the agent together:
     ```bash
     soapay distribute --preset dividend --csv examples/demo/holders.csv --asset usdc --total 0.5 --chunk 0.05 --execute
     ```
     Plan → preflight (payer, balances, "2 txs: 1 approval (exact total) + 1 pay (12 lines)") → Basescan links. On-chain it's 12 equal-looking lines to 12 strangers; the agent's lines are indistinguishable from the people's.
  3. Ana scans with her phrase (`soapay scan --mnemonic-env SOAPAY_PHRASE --from <block> --known-payer <company>`): 4 lines, 0.2 USDC, real balances.
  4. The agent scans over MCP ("the pay run has 12 lines; 2 are mine"), then spends 0.02 USDC to a name with no ETH: gas is paid in USDC (7702 + paymaster), the same path the recipient app uses.
- **Say:** "Same SDK under the apps, a CLI and an agent. A dividend is one command. The agent is just another payee: same name, same privacy, same exit."
- **Agent use cases to name:** revenue share, bounties, contractor invoices, agent-to-agent settlement. **"Why not x402?"** x402 pays the same public address on every call. Per-request stealth payments work on this same design; whether they fit is cost vs privacy (one announcement per payment is about 2x a transfer's gas on Base, scanning volume grows, and consolidating many small payments reveals totals), so they're on the roadmap, not ruled out.
- **Pre-staged (once):** `pnpm build`, then `pnpm --filter @soapay/examples demo:setup` (claims the people's names through the API relayer and writes `examples/demo/holders.csv`; the recovery phrases stay in the git-ignored `scripts/.demo-recipients.local.json`). A funded Base Sepolia EOA as the payer: `PAYER_PRIVATE_KEY` in the environment, or `PAYER_ENV_FILE=apps/mcp/.env PAYER_ENV_VAR=AGENT_PAYER_PRIVATE_KEY`. Each run spends `DIVIDEND_TOTAL` (default 0.5 USDC) plus a little gas.
- **Rehearse without sending:** `DEMO_DRY=1 scripts/demo-pluggable.sh` (plan only).
- **Fallback:** `DEMO_REPLAY=1 scripts/demo-pluggable.sh` replays the recorded live run offline, in colour ([`demo-screens/beat4-pluggable-live.txt`](demo-screens/beat4-pluggable-live.txt), `.ansi` for colour). Live txs from that recording, 2026-09-26: pay run [0xf7fb06df…](https://sepolia.basescan.org/tx/0xf7fb06dfa47313fbeab80fe6e01cc0d003d38d221819ad35d09bfcad9051ce0e) (12 lines, 5 payees incl. the agent), the agent's gasless spend [0x35172021…](https://sepolia.basescan.org/tx/0x3517202141e4f1ad9849aa40f04ec3d7e332bd8d38a72d991d64d1e4b4d3f3e2).

### Beat 5: Spend gaslessly, and the guard → compliant exit (1:50–2:25) · Send → Exit · (Privacy Pools)

- **Clicks, gasless spend:** **Send** tab ([r09](demo-screens/r09-send-form.png)) → To = a fresh address, Amount `0.5` (live; the screenshots show `80` from mock mode) → **Review**: "No new links. This spend doesn't connect any of your stealth addresses to each other or to an identifiable wallet" ([r14](demo-screens/r14-send-review-ok.png)) → **Send now** → "Sent · 1 transaction confirmed" ([r15](demo-screens/r15-send-done.png)), with the navy **Gas proof** panel under it (D-41), read live: "0 ETH here. Gas was paid in USDC by the paymaster." Rows: ETH balance now `0 ETH`; Account "Upgraded to a smart account via EIP-7702, delegate = Simple7702Account"; Nonce "1: used by the 7702 authorization; no transaction of its own"; the spend tx and userOp; Submitted by the bundler; Gas paid by "Circle Paymaster 0x3BA9…8966"; Gas fee in USDC. Each links to Basescan (live only). The same panel is in the address's **Details** on Payments after it spent.
- **Say:** "Zero ETH on this address. The chain shows who paid the gas: the bundler fronted it, and Circle's paymaster took the fee from this address in USDC. Every line here is a chain read." (Don't say "never received ETH": the panel deliberately doesn't claim it.)
- **Clicks, guard:** Send again, To = my main wallet (labelled under **Labels** beforehand, [r10](demo-screens/r10-labels.png)), an amount larger than any one address holds (live: `2`; mock: `1200`) → **Review** (the guard blocks it, so nothing is sent) → "**Blocked by the privacy guard.** Spending from 3 unlinked clusters in one operation links them to each other. Sending here ties these funds to you" ([r11](demo-screens/r11-send-guard-block.png)) → **Exit through Privacy Pools** → the Exit screen plans one leg per address ([r12](demo-screens/r12-exit-plan.png)). Scroll to the pre-approved **Finished exit** ([r13](demo-screens/r13-exit-done.png)).
- **Say:** "My coworkers know my main wallet, so the app refuses to link my salary to it. The way out is a screened pool: each address deposits on its own, and the withdrawal to my wallet can't be matched to a deposit."
- **Bounty:** none of the three. This beat evidences PRD Goals 3 and 5: the gasless spend, the guard and the compliant exit.
- **Pre-staged:** the main wallet labelled; one exit leg already approved and withdrawn.
- **Live exit tx links:** pending the funded run (docs/testnet-deployment.md, "Live exit"); show the finished leg's Basescan/Etherscan links from the Exit screen.
- **Fallback:** a bundler or paymaster stall past 10 s: show the live spend tx tab. Don't click **Start exit** live (the ASP wait is minutes to hours); only show the finished leg.

### Beat 6: Convert in place (2:25–2:40) · Convert · Uniswap

- **Clicks:** **Convert** tab ([r16](demo-screens/r16-convert-form.png)) → From address (one of "Me"'s addresses) → Amount `1` (live; the mock screenshots show `100` from a 500 USDC mock address) → To `ETH` → **Get quote** → "1.00 USDC → ~… ETH in 0x…, output stays there. Route USDC -[v3 0.05%]-> ETH" ([r17](demo-screens/r17-convert-quote.png)) → **Convert** → "Converted" ([r18](demo-screens/r18-convert-done.png)).
- **Say:** "Want ETH instead? Uniswap swaps it inside the same address, so nothing moves between my addresses and nothing gets linked."
- **Bounty:** Uniswap API (Trading API quote with a Universal Router fallback).
- **Fallback:** Base Sepolia routing times out upstream (FEEDBACK.md). Show the quote only, and say the swap was proven on a Base fork (bounty-integrations). If the quote itself fails, skip the beat and keep its 15 s for Beat 7.

### Beat 7: Key rotation protected by World ID (2:40–3:00) · Name · World ID

- **Clicks (recipient "Me"):** **Name** tab ([r19](demo-screens/r19-name.png)) → **Rotate to new keys** ([r20](demo-screens/r20-rotate-confirm.png)) → **Continue to World ID** → "Prove it's still you" → **Confirm with World ID** ([r21](demo-screens/r21-rotate-worldid.png)) → Selfie Check in the simulator → "Keys rotated … with a World ID attestation" ([r22](demo-screens/r22-rotate-done.png)).
- **Clicks (sender):** **Recipients** → **Re-verify all** → jordan shows **Re-verified by World ID**, and an unattested change shows **Blocked · record changed** ([s13](demo-screens/s13-sender-rotation-status.png)).
- **Say (close):** "The name decides where salary goes, so changing it takes the same human who enrolled. A stolen key alone gets blocked. One name, a fresh address every payday, and no coworker can tell which line is yours."
- **Bounty:** World ID (IDKit Selfie Check session, EIP-712 attestation enforced by the sender).
- **Pre-staged:** the session attached at enrollment (past the 72 h cooldown if it was attached later); the simulator open and logged in.
- **Fallback:** if the simulator stalls past 10 s, cancel and show [s13](demo-screens/s13-sender-rotation-status.png) (the attested vs blocked pills), or run the sender's mock "Rotate keys (World ID attested)" on the localhost fallback.

## UI vs SDK

The demo is UI-only: judges follow a person, not a library. The SDK appears in **at most one beat**, and only as a sentence plus one frame. Say "every screen you saw calls `@soapay/sdk`; so does this agent" over a 5-second terminal clip of the MCP server (`resolve_name` on `mcp-agent-7c1e.soapay.eth`, or `whoami`). That clip replaces the last 5 s of Beat 7 if there's time. Otherwise it goes on the closing slide, with the repo link. If the terminal beat (Beat 4b) runs, it *is* the SDK beat: skip this clip. Don't live-code, and don't show the SDK anywhere a screen already shows the same thing.

## Gaps that weaken the story (recommendations; no app code changed)

1. ~~**No coworker-view visual.**~~ Done (D-41): Payments → Pay runs → **Two views**, and the sender's run page **What coworkers see**.
2. **The landing overclaim is still live.** The live sender landing says "…and the payroll never shows up on a block explorer" ([live-sender-landing](demo-screens/live-sender-landing.png)). Beat 4 shows the opposite. Change it with CK before judging, e.g. "…so nobody can tell which line is whose."
3. **Onboarding is too long to show live.** Save the recovery kit, then lock with a passkey (the 3-word backup check is gone since D-44, so it is shorter than it was). Pre-stage it (Beat 2). Consider a "demo account" restore, or skipping straight to Register for a pre-made profile.
4. **The mock wallet can't sign a pay run** ("Not sent: the approval didn't go through"), so the pay run is the one beat with no offline fallback that actually sends. Keep the live tx link ready.
5. **The invite's org name doesn't match in mock mode.** The link carries `org=Acme Labs`, but onboarding shows "Invited by Acme Robotics" (the mock fixture). Check that the live path shows the employer's own org.
6. **After an exit, mock balances aren't refreshed.** The exited addresses still show 500 USDC under Convert's From address. Confirm it's mock-only before showing Exit and Convert back to back.
7. ~~**Guard copy exposes a raw pay-run tx hash.**~~ Done (D-41): hashes in guard copy render short (`0x681f…9e2a`) and link to Basescan outside mock mode.
8. **Run pages and Basescan:** live runs already link each step's tx (Tx column), and the **What coworkers see** panel links each landed tx (D-41). Mock runs never send, so they show "—" and a labelled preview instead.
