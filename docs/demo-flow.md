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

1. **Fix the landing overclaim first** (see Gaps). Otherwise the first screen the judges read says something false.
2. **Employer wallet:** a plain EOA on Base Sepolia with about 50 USDC (faucet.circle.com) and a little ETH. The sender then takes the `StealthDisperse` path ("Approve the exact total, then 1 StealthDisperse payment"). The mock demo wallet can't sign, so the live pay run needs this real wallet.
3. **Sender vault:** log in and create the vault ("Use a device key (no passphrase)"). Roster: at least 10 names. With fewer than 10 the Review page shows the small-team warning (correct, but it takes airtime). Keep **Denominated payouts** on, and use a small chunk (e.g. `1` USDC) so that 1.0-unit lines make a busy tx on a testnet budget.
4. **Two recipient profiles**, in two browser profiles:
   - **"Me" (Jordan):** fully onboarded with a World ID Selfie Check session attached at enrollment (or attached 72 h earlier; the cooldown applies), labelled main wallet under Labels, and already paid by 2–3 earlier runs, so Payments shows several addresses from the Acme payer.
   - **"New hire":** a fresh invite link opened and left on the first onboarding screen, or on the Recovery step (see Beat 2).
5. **Pre-generated invite:** create it now under Recipients → Invite employee → **Sign and create link**. Keep the link and its QR.
6. **Pre-approved exit leg:** on "Me", run one leg the day before under Exit (**Withdraw round amounts** on; **Wait a random delay after approval** off for the demo leg). A leg needs at least **16.40 USDC** on one stealth address (the planner shows the minimum and how much a short address needs); pay 18 to be safe. The scripted live run and its funding status are in docs/testnet-deployment.md, "Live exit": as of 2026-09-26 it is blocked on 5.80 test USDC for the deployer, so there are no live tx links yet; add them to Beat 5 once it has run. If the leg is still queued in its timing window, **Start now** on the leg starts it at once. The ASP approval can take hours, so it has to be approved before you go on stage. The Exit screen then lists it under **Finished exit** with its Basescan/Etherscan step links.
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
- **Say (read the Review headline aloud):** "*26,600 USDC to 6 people, on 56 fresh addresses. On chain this looks like 56 payments of about 500 USDC to 56 strangers.* Each name is re-checked against the key we pinned, and it's one transaction that pays and announces every line."
- **Bounty:** ENSv2 (resolve-and-pin on every run).
- **Pre-staged:** a funded employer EOA; the roster already resolved once.
- **Fallback:** Base Sepolia confirmations normally take a few seconds. If the wallet or the RPC stalls for more than about 10 s, say "here's the same run from earlier" and switch to the live pay-run tx tab. Don't wait on stage. If the approval fails, the run page shows "Not sent: the approval didn't go through" plus **Retry unpaid lines** ([s10](demo-screens/s10-sender-send-attempt.png)); retry once, then fall back.

### Beat 4: What a coworker sees vs what I see (1:20–1:50) · the core moment

- **Screens, side by side:** left, the pay-run tx on Basescan (the **Logs** or ERC-20 transfers tab: N transfers of the same chunk size to unrelated addresses). Right, "Me" on **Payments**: "7,951.00 USDC across 19 addresses … Checked 3,139 announcements in 1894 ms on 4 workers; 19 new payments" ([r08](demo-screens/r08-payments.png)).
- **Clicks:** **Rescan** on Payments, so the new lines from Beat 3 appear live.
- **Say:** "Left is my coworker's view: a list of equal payments to strangers. They know their own lines, and that's all. Right is my app, the only place those addresses come together, because only my viewing key can find them. Even the unknown payer that faked a 10,000 USDC announcement shows its real balance, 1 USDC."
- **Bounty:** none directly. This is the product claim (PRD Goal 2).
- **Proposed visual (the owner's pending question):** a **"Coworker view / My view" toggle** on each pay-run group in Payments. Coworker view renders every line of that tx as Basescan shows it: amount plus a short address, with nothing highlighted. My view is the same list with my lines highlighted and every other line labelled "not mine, can't tell whose". The data is already there, because the scanner reads every announcement of the tx to find mine. Until it's built, use the two-window layout above. See Gaps #1.
- **Fallback:** if Basescan throws its Cloudflare check, show the same tx in the pre-warmed tab, or the StealthDisperse contract's token-transfer list.

### Beat 5: Spend gaslessly, and the guard → compliant exit (1:50–2:25) · Send → Exit · (Privacy Pools)

- **Clicks, gasless spend:** **Send** tab ([r09](demo-screens/r09-send-form.png)) → To = a fresh address, Amount `80` → **Review**: "No new links. This spend doesn't connect any of your stealth addresses to each other or to an identifiable wallet" ([r14](demo-screens/r14-send-review-ok.png)) → **Send** → "Sent · 1 transaction confirmed" ([r15](demo-screens/r15-send-done.png)).
- **Say:** "No ETH ever touches a stealth address: gas is paid in USDC through a 7702 smart account and Circle's paymaster."
- **Clicks, guard:** Send again, To = my main wallet (labelled under **Labels** beforehand, [r10](demo-screens/r10-labels.png)), Amount `1200` → **Review** → "**Blocked by the privacy guard.** Spending from 3 unlinked clusters in one operation links them to each other. Sending here ties these funds to you" ([r11](demo-screens/r11-send-guard-block.png)) → **Exit through Privacy Pools** → the Exit screen plans one leg per address ([r12](demo-screens/r12-exit-plan.png)). Scroll to the pre-approved **Finished exit** ([r13](demo-screens/r13-exit-done.png)).
- **Say:** "My coworkers know my main wallet, so the app refuses to link my salary to it. The way out is a screened pool: each address deposits on its own, and the withdrawal to my wallet can't be matched to a deposit."
- **Bounty:** none of the three. This beat evidences PRD Goals 3 and 5: the gasless spend, the guard and the compliant exit.
- **Pre-staged:** the main wallet labelled; one exit leg already approved and withdrawn.
- **Live exit tx links:** pending the funded run (docs/testnet-deployment.md, "Live exit"); show the finished leg's Basescan/Etherscan links from the Exit screen.
- **Fallback:** a bundler or paymaster stall past 10 s: show the live spend tx tab. Don't click **Start exit** live (the ASP wait is minutes to hours); only show the finished leg.

### Beat 6: Convert in place (2:25–2:40) · Convert · Uniswap

- **Clicks:** **Convert** tab ([r16](demo-screens/r16-convert-form.png)) → From address (one 500 USDC address) → Amount `100` → To `ETH` → **Get quote** → "100.00 USDC → ~0.033333 ETH in 0xb005…, output stays there. Route USDC -[v3 0.05%]-> ETH" ([r17](demo-screens/r17-convert-quote.png)) → **Convert** → "Converted" ([r18](demo-screens/r18-convert-done.png)).
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

The demo is UI-only: judges follow a person, not a library. The SDK appears in **at most one beat**, and only as a sentence plus one frame. Say "every screen you saw calls `@soapay/sdk`; so does this agent" over a 5-second terminal clip of the MCP server (`resolve_name` on `mcp-agent-7c1e.soapay.eth`, or `whoami`). That clip replaces the last 5 s of Beat 7 if there's time. Otherwise it goes on the closing slide, with the repo link. Don't live-code, and don't show the SDK anywhere a screen already shows the same thing.

## Gaps that weaken the story (recommendations; no app code changed)

1. **No coworker-view visual.** Beat 4 is the core claim, and today it needs two windows and Basescan. Build the "Coworker view / My view" toggle proposed in Beat 4 (recipient Payments, per pay-run tx). It needs no new data, because the scanner already fetches every announcement of the tx.
2. **The landing overclaim is still live.** The live sender landing says "…and the payroll never shows up on a block explorer" ([live-sender-landing](demo-screens/live-sender-landing.png)). Beat 4 shows the opposite. Change it with CK before judging, e.g. "…so nobody can tell which line is whose."
3. **Onboarding is too long to show live.** Save the recovery kit, then lock with a passkey (the 3-word backup check is gone since D-44, so it is shorter than it was). Pre-stage it (Beat 2). Consider a "demo account" restore, or skipping straight to Register for a pre-made profile.
4. **The mock wallet can't sign a pay run** ("Not sent: the approval didn't go through"), so the pay run is the one beat with no offline fallback that actually sends. Keep the live tx link ready.
5. **The invite's org name doesn't match in mock mode.** The link carries `org=Acme Labs`, but onboarding shows "Invited by Acme Robotics" (the mock fixture). Check that the live path shows the employer's own org.
6. **After an exit, mock balances aren't refreshed.** The exited addresses still show 500 USDC under Convert's From address. Confirm it's mock-only before showing Exit and Convert back to back.
7. **Guard copy exposes a raw pay-run tx hash** ("…same pay run (0x681f…)") on the block screen. Consider a short hash, or "the September run".
8. **Run and History pages have no Basescan link** in mock (the Tx column shows "—" before sending). Check that live runs link each tx, because Beat 3's fallback depends on it.
