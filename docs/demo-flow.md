# Demo flow: 3 minutes, on CK's UI

A live script for the Soapay demo. It follows CK's screens in the order they present themselves: the sender app (landing → login → vault → Recipients → Pay run → Review → History), then the recipient app (invite → Keys → Lock → Register → Name → Recovery → Share → Payments → Send → Name). No step below needs a screen that doesn't exist, except the one visual proposed in "Beat 4".

**Since D-52/D-53 (2026-09-26):** on Base Sepolia the apps pay in Soapay's **mock USDC**, every wallet that opens the company app gets **1,000,000 test USDC once** (welcome drop), stealth spends are **gas-sponsored**, the **Exit** tab is hidden (the mock token can't bridge over CCTP), and the employee app has **no Convert** tab on any chain. Screenshots r12, r13 and r16–r18 predate this and show screens that are no longer in the testnet build.

Every screen and button label below was clicked through on 2026-09-26: both apps in mock mode (`VITE_MOCK_API=1` / `VITE_MOCK_ENS=1`), plus the live pages at https://soapay.up.railway.app (landing and company app at `/`, employee app at `/app/`). The screenshots are in [`demo-screens/`](demo-screens/) (`s*` = sender, `r*` = recipient, `live-*` = Railway); all of them were retaken the same day after the recovery-kit and passkey onboarding (D-44, D-45), at 1280×800 with `?motion=off`.

**The story in one line:** a public payroll batch leaks everyone's salary to every coworker. Soapay gives each employee one name and pays a fresh address every time, so a coworker sees the batch but can't tell which line is whose.

## Links to have open

| What | Link |
| --- | --- |
| Landing + company (sender) app (live) | https://soapay.up.railway.app/ |
| Employee (recipient) app (live) | https://soapay.up.railway.app/app/ ([live-recipient-home](demo-screens/live-recipient-home.png)) |
| Live pay run (StealthDisperse → 2 stealth addresses, 3.0 + 2.5 USDC, 2 Announcements; checked by RPC) | https://sepolia.basescan.org/tx/0x24f23d610d1917905d3896e282243b07a038afb2bf266f94f11f31ea9e5b492d |
| Live gasless 7702 spend, sponsored (mock USDC, D-52) | https://sepolia.basescan.org/tx/0x15ea6dcd7f489ff829365c6e9dfef0b86859aba4cdc97e0a010fa761e418265c |
| Earlier gasless spend (Circle USDC, gas paid in USDC by the Circle paymaster) | https://sepolia.basescan.org/tx/0x1167b83dfab7476ac32b286b890fdcfdba396766d9389778568d949cbffc1bae |
| `StealthDisperse` on Base Sepolia | https://sepolia.basescan.org/address/0x6B7a1cC570Af2DDd427DA694351438F0FE8039CA |
| Canonical ERC-5564 Announcer | https://sepolia.basescan.org/address/0x55649E01B5Df198D18D95b5cc5051630cfD45564 |
| ENSv2 names paid live | `pay392111.soapay.eth`, `pay730021.soapay.eth` (resolve with the one-liner in `docs/bounty-integrations.md`) |

Basescan is behind a Cloudflare check that a headless browser can't pass. Open these tabs by hand in the demo browser beforehand, and keep them logged in and warm.

## Pre-demo setup (the day before, then 15 minutes before)

**Test USDC is no longer scarce (D-52).** The pay token on Base Sepolia is Soapay's mock USDC: the employer wallet gets 1,000,000 of it automatically the first time it opens the company app (a "Welcome: 1,000,000 test USDC sent to your wallet" banner with a Basescan link), and `scripts/fund-usdc.sh <address>` mints more. Stealth spends are gas-sponsored, so recipients pay nothing. The apps still default to small testnet amounts (D-47: 5 USDC chunks, small example salaries) so runs stay readable; the Review confirmation now only appears above the 1,000,000 drop.

1. **Check the landing copy** (see Gaps, item 2): the live landing is fixed, but make sure the build you demo from has the fix too. Otherwise the first screen the judges read says something false.
2. **Employer wallet:** a plain EOA on Base Sepolia. Its mock USDC arrives by itself on first login (or `scripts/fund-usdc.sh <address>`); it still needs a little Base Sepolia ETH for the approve + pay txs (the welcome drop's ETH drip is off pending an owner decision). A smart wallet (Coinbase Smart Wallet) needs no ETH: its EIP-5792 batch is gas-sponsored. The sender then takes the `StealthDisperse` path ("Approve the exact total, then 1 StealthDisperse payment"). The mock demo wallet can't sign, so the live pay run needs this real wallet.
3. **Sender vault:** log in and create the vault ("Use a device key (no passphrase)"). Roster: at least 10 names. With fewer than 10 the Review page shows the small-team warning (correct, but it takes airtime). Keep **Denominated payouts** on. Give the roster small salaries (0.5–1.5 USDC each, about 8 USDC for ten people) and set Settings → chunk to `0.25`, so the run is a busy tx of about 40 equal lines on a testnet budget. (The testnet default chunk is 5 USDC; with sub-5 salaries every line would be a remainder.)
4. **Two recipient profiles**, in two browser profiles:
   - **"Me" (Jordan):** fully onboarded with a World ID Selfie Check session attached at enrollment (or attached 72 h earlier; the cooldown applies), labelled main wallet under Labels, and already paid by 2–3 earlier runs, so Payments shows several addresses from the Acme payer.
   - **"New hire":** a fresh invite link opened and left on the first onboarding screen, or on the Recovery step (see Beat 2).
5. **Pre-generated invite:** create it now under Recipients → Invite employee → **Sign and create link**. Keep the link and its QR.
6. **Exit (not in the testnet build since D-52):** the Exit tab is hidden on Base Sepolia because the mock token can't bridge. To show it, use the recorded live run's links (Beat 5) or a build with `VITE_PAY_TOKEN=0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle USDC, funded through Circle's faucet). The rest of this item describes that Circle-USDC setup. **Pre-approved exit leg:** on "Me", run one leg the day before under Exit (**Withdraw round amounts** on; **Wait a random delay after approval** off for the demo leg). Fees are roughly fixed per leg (D-48): bridge ≈ 1.8–2.2 USDC, Sepolia deposit gas ≈ 5.1–5.8, and the testnet relayer ≈ 21.5 USDC per withdrawal, which the pool only allows up to 30% of it. So a **relayed** leg needs at least **≈ 81.3 USDC** on one stealth address, and a **direct** withdrawal (tick **Withdraw directly**; the destination wallet pays ≈ 0.001 Sepolia ETH, funded from a faucet or an exchange, not from your own wallets) needs **≈ 18.6 USDC**. The planner shows the minimum, the full cost ("You receive ≈ X of Y (Z%)") and a warning above 15%. For the demo leg, pay 100 USDC to relay (≈ 69 arrives) or 20 USDC and withdraw directly (≈ 11 arrives). The scripted live run and its funding status are in docs/testnet-deployment.md, "Live exit": the 2026-09-26 run completed: 18 USDC paid → bridged (16.12 arrived) → deposited → approved → withdrawn **directly** (9.95 USDC to a fresh faucet-funded wallet), because the relayer's ≈ 21.5 USDC fee exceeded the amount in the pool. If the leg is still queued in its timing window, **Start now** on the leg starts it at once. The ASP approval can take hours, so it has to be approved before you go on stage. The Exit screen then lists it under **Finished exit** with its Basescan/Etherscan step links.
7. **World ID:** the API runs `WORLD_ENV=staging` (the simulator). Open the simulator on a second device or tab and do one full rotate end to end beforehand (it hasn't been run live yet; see bounty-integrations "Before judging").
8. **Fallback deck:** the screenshots in `demo-screens/` in slide order, plus a mock-mode build of both apps on localhost (the recipient's `pnpm --filter @soapay/recipient dev:mock` runs the whole flow offline, exit included, in about 35 s per leg).

## The script

Total 3:00. Time is the budget for each beat; the clicks are exactly CK's labels.

### Beat 1: The problem (0:00–0:15) · sender landing

- **Screen:** the landing at `/`, which is also the company app's front door ([s01](demo-screens/s01-sender-landing.png) in mock mode; live: [live-sender-landing](demo-screens/live-sender-landing.png)).
- **Clicks:** none yet.
- **Say:** "Pay your team in USDC on-chain and every coworker can read everyone's salary off the batch. A wallet address is a public bank statement."
- **Bounty:** none (context).
- **Fallback:** none needed.

### Beat 2: One name, a fresh address per payment (0:15–0:50) · Recipients → invite → onboarding · ENSv2

- **Clicks (sender):** **Login with wallet** → pick the wallet ([s02](demo-screens/s02-sender-login.png)) → **Unlock on this device** (first time: **Use a device key (no passphrase)**, [s03](demo-screens/s03-sender-vault.png)) → you land on **Recipients** ([s06](demo-screens/s06-sender-recipients.png); an empty vault looks like [s04](demo-screens/s04-sender-first.png)). Under **Invite employee**: Name `jordan`, Salary per run, Organisation → **Sign and create link** ([s05](demo-screens/s05-sender-invite-link.png)). Point at the row: **Invited (pending)**.
- **Clicks (recipient, the "New hire" profile, pre-opened on the invite link):** "Invited by … Your pay name will be jordan.soapay.eth" ([r01](demo-screens/r01-invite-welcome.png)). Without an invite, the Welcome screen offers only **Create a new account** and **Restore from recovery phrase** ([r00](demo-screens/r00-welcome.png); no wallet-signature option since D-45). The stepper reads Keys · Lock · Register · Name · Recovery · Share. Don't do the recovery kit and lock live: Keys is **Save your recovery kit** (Download recovery kit / Copy phrase / Show words, then "I saved my recovery kit somewhere safe"; no word quiz since D-44, [r02](demo-screens/r02-onboard-phrase.png)); Lock is **Lock this device**, whose explainer says "Your device will ask to save a passkey… It's saved as jordan.soapay.eth in your password manager" → **Use Face ID / fingerprint (passkey)** ([r03b](demo-screens/r03b-onboard-lock.png)); the next screen confirms **Passkey saved on this device** ([r03c](demo-screens/r03c-onboard-passkey-saved.png)). Pre-stage the profile at **Register** and click **Register for free** ([r04](demo-screens/r04-onboard-register.png)) → **Continue** on the name ([r05](demo-screens/r05-onboard-name.png)) → on Recovery, **Skip and claim jordan.soapay.eth** (World ID is shown later) ([r06](demo-screens/r06-onboard-worldid.png)) → Share: "Share this one string with your employer" ([r07](demo-screens/r07-onboard-share.png)).
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

- **Screen:** "Me" on **Payments** ([r08](demo-screens/r08-payments.png)), scrolled to **Pay runs** (D-41, [r08a](demo-screens/r08a-payruns.png)). One row per pay-run transaction that paid me: block, payer, how many of my lines are in it, and the tx.
- **Clicks:** **Rescan** (so Beat 3's lines appear) → **Two views** on the newest run. It opens on **Coworker view** ([r08b](demo-screens/r08b-payrun-coworker-view.png)): every line of that transaction as the chain shows it (short stealth address, amount from the USDC Transfer log, owner "unknown"), under "This is everything anyone can see on-chain: 50 payments totalling … USDC from 0x… in one transaction". Flip the toggle to **My view** ([r08c](demo-screens/r08c-payrun-my-view.png)): the same list, my lines highlighted **You**, and the honest count, "6 of 50 lines are yours (2,750.00 USDC)". **View on Basescan ↗** opens the same tx (live only; mock mode has no explorer link).
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
     Plan (with a `pins` line: the first run pins every name's meta-address in `examples/demo/.soapay/pins.json`; a later change stops the run unless World ID re-verified it, D-49) → preflight (payer, balances, "2 txs: 1 approval (exact total) + 1 pay (12 lines)") → Basescan links. On-chain it's 12 equal-looking lines to 12 strangers; the agent's lines are indistinguishable from the people's.
  3. Ana scans with her phrase (`soapay scan --mnemonic-env SOAPAY_PHRASE --from <block> --known-payer <company>`): 4 lines, 0.2 USDC, real balances.
  4. The agent scans over MCP ("the pay run has 12 lines; 2 are mine"), then spends 0.02 USDC to a name with no ETH: gas is sponsored on the testnet (7702 + paymaster; on Base the Circle paymaster takes it in USDC), the same path the recipient app uses.
- **Say:** "Same SDK under the apps, a CLI and an agent. A dividend is one command. The agent is just another payee: same name, same privacy, same exit."
- **Agent use cases to name:** revenue share, bounties, contractor invoices, agent-to-agent settlement. **"Why not x402?"** x402 pays the same public address on every call. Per-request stealth payments work on this same design; whether they fit is cost vs privacy (one announcement per payment is about 2x a transfer's gas on Base, scanning volume grows, and consolidating many small payments reveals totals), so they're on the roadmap, not ruled out.
- **Pre-staged (once):** `pnpm build`, then `pnpm --filter @soapay/examples demo:setup` (claims the people's names through the API relayer and writes `examples/demo/holders.csv`; the recovery phrases stay in the git-ignored `scripts/.demo-recipients.local.json`). A funded Base Sepolia EOA as the payer: `PAYER_PRIVATE_KEY` in the environment, or `PAYER_ENV_FILE=apps/mcp/.env PAYER_ENV_VAR=AGENT_PAYER_PRIVATE_KEY`. Each run spends `DIVIDEND_TOTAL` (default 0.5 USDC) plus a little gas.
- **Rehearse without sending:** `DEMO_DRY=1 scripts/demo-pluggable.sh` (plan only).
- **Fallback:** `DEMO_REPLAY=1 scripts/demo-pluggable.sh` replays the recorded live run offline, in colour ([`demo-screens/beat4-pluggable-live.txt`](demo-screens/beat4-pluggable-live.txt), `.ansi` for colour). Live txs from that recording, 2026-09-26: pay run [0xf7fb06df…](https://sepolia.basescan.org/tx/0xf7fb06dfa47313fbeab80fe6e01cc0d003d38d221819ad35d09bfcad9051ce0e) (12 lines, 5 payees incl. the agent), the agent's gasless spend [0x35172021…](https://sepolia.basescan.org/tx/0x3517202141e4f1ad9849aa40f04ec3d7e332bd8d38a72d991d64d1e4b4d3f3e2).

### Beat 5: Spend gaslessly, and the guard → compliant exit (1:50–2:25) · Send → Exit · (Privacy Pools)

- **Clicks, gasless spend:** **Send** tab ([r09](demo-screens/r09-send-form.png)) → To = a fresh address, Amount `0.5` (live; the screenshots show `80` from mock mode) → **Review**: "No new links. This spend doesn't connect any of your stealth addresses to each other or to an identifiable wallet" ([r14](demo-screens/r14-send-review-ok.png)) → **Send now** → "Sent · 1 transaction confirmed" ([r15](demo-screens/r15-send-done.png)), with the navy **Gas proof** panel under it (D-41), read live: "0 ETH here. Gas was sponsored (testnet); on mainnet the Circle paymaster takes it in USDC." Rows: ETH balance now `0 ETH`; Account "Upgraded to a smart account via EIP-7702, delegate = Simple7702Account"; Nonce "1: used by the 7702 authorization; no transaction of its own"; the spend tx and userOp; Submitted by the bundler; Gas paid by "Sponsoring paymaster (testnet) 0x8888…2402"; Gas fee "None: sponsored on this testnet". Each links to Basescan (live only). The same panel is in the address's **Details** on Payments after it spent.
- **Say:** "Zero ETH on this address. The chain shows who paid the gas: the bundler fronted it and a paymaster covered it. On this testnet that's sponsored; on mainnet Circle's paymaster takes the fee from this address in USDC. Every line here is a chain read." (Don't say "never received ETH": the panel deliberately doesn't claim it.)
- **Clicks, guard:** Send again, To = my main wallet (labelled under **Labels** beforehand, [r10](demo-screens/r10-labels.png)), an amount larger than any one address holds (live: `2`; mock: `1200`) → **Review** (the guard blocks it, so nothing is sent) → "**Blocked by the privacy guard.** Spending from 3 unlinked clusters in one operation links them to each other. Sending here ties these funds to you" ([r11](demo-screens/r11-send-guard-block.png)). On the testnet build there's no **Exit through Privacy Pools** button (Exit is hidden with the mock token, D-52); the guard just blocks and explains why. For the exit, show the recorded live run's links below (or, on a Circle-USDC build, **Exit through Privacy Pools** → [r12](demo-screens/r12-exit-plan.png) / [r13](demo-screens/r13-exit-done.png)).
- **Say:** "My coworkers know my main wallet, so the app refuses to link my salary to it. On mainnet the way out is a screened pool: each address deposits on its own, and the withdrawal to my wallet can't be matched to a deposit. Here's one we ran end to end with real Circle USDC."
- **Bounty:** none of the three. This beat evidences PRD Goals 3 and 5: the gasless spend, the guard and the compliant exit.
- **Pre-staged:** the main wallet labelled; the live exit's tx tabs open.
- **Live exit tx links (2026-09-26):** [pay](https://sepolia.basescan.org/tx/0xbd9d0001b4fe5fbee969003921b43a82608e7e3d0748a3fcd347f33244a3799b) → [burn](https://sepolia.basescan.org/tx/0x78fa2c713458f30879096a4d79a024f4fc0eab55aceffc8789111beaf19b6c89) → [mint](https://sepolia.etherscan.io/tx/0x5feec0c529b0b424b98c3b4c28f00191d20e7ca25b52b5d8d41627e7779436ab) → [deposit](https://sepolia.etherscan.io/tx/0xa7c6ff5f59c0c231b53df82859fca712798d398e9a907aefba778a5495d013e0) → [direct withdrawal](https://sepolia.etherscan.io/tx/0xed9235c87f7643bde048cd9e29c8abebe989a64016a628c85faa7ed5724fc672). On stage, show the finished leg's links from the Exit screen.
- **Fallback:** a bundler or paymaster stall past 10 s: show the live spend tx tab. If the API says gas sponsorship is off (no `PIMLICO_API_KEY` on the server), show the recorded sponsored spend instead.

### Beat 6: removed (D-53)

The Convert tab is gone from the employee app (the Uniswap bounty is no longer targeted). Its 15 s go to Beat 7. Swap in place still exists in the SDK and the MCP `swap_in_place` tool.

### Beat 7: Key rotation protected by World ID (2:25–3:00) · Name · World ID

- **Clicks (recipient "Me"):** **Name** tab ([r19](demo-screens/r19-name.png)) → **Rotate to new keys** ([r20](demo-screens/r20-rotate-confirm.png)) → **Continue to World ID** → "Prove it's still you" → **Confirm with World ID** ([r21](demo-screens/r21-rotate-worldid.png)) → Selfie Check in the simulator → "Keys rotated … with a World ID attestation" ([r22](demo-screens/r22-rotate-done.png)).
- **Clicks (sender):** **Recipients** → **Re-verify all** → jordan shows **Re-verified by World ID**, and an unattested change shows **Blocked · record changed** ([s13](demo-screens/s13-sender-rotation-status.png)). A name's detail shows the pinned record and every fresh address paid ([s12](demo-screens/s12-sender-recipient-detail.png)).
- **Say (close):** "The name decides where salary goes, so changing it takes the same human who enrolled. A stolen key alone gets blocked. One name, a fresh address every payday, and no coworker can tell which line is yours."
- **Bounty:** World ID (IDKit Selfie Check session, EIP-712 attestation enforced by the sender).
- **Pre-staged:** the session attached at enrollment (past the 72 h cooldown if it was attached later); the simulator open and logged in.
- **Fallback:** if the simulator stalls past 10 s, cancel and show [s13](demo-screens/s13-sender-rotation-status.png) (the attested vs blocked pills), or run the sender's mock "Rotate keys (World ID attested)" on the localhost fallback.

## UI vs SDK

The demo is UI-only: judges follow a person, not a library. The SDK appears in **at most one beat**, and only as a sentence plus one frame. Say "every screen you saw calls `@soapay/sdk`; so does this agent" over a 5-second terminal clip of the MCP server (`resolve_name` on `mcp-agent-7c1e.soapay.eth`, or `whoami`). That clip replaces the last 5 s of Beat 7 if there's time. Otherwise it goes on the closing slide, with the repo link. If the terminal beat (Beat 4b) runs, it *is* the SDK beat: skip this clip. Don't live-code, and don't show the SDK anywhere a screen already shows the same thing.

## Gaps that weaken the story (recommendations; no app code changed)

1. ~~**No coworker-view visual.**~~ Done (D-41): Payments → Pay runs → **Two views**, and the sender's run page **What coworkers see**.
2. ~~**The landing overclaim is still live.**~~ Fixed on the live landing (checked 2026-09-26): "…so on a block explorer the payroll shows new addresses, not your team's wallets" ([live-sender-landing](demo-screens/live-sender-landing.png)). The fix isn't on this branch yet: `apps/sender/src/pages/Landing.tsx` here (and the mock-mode [s01](demo-screens/s01-sender-landing.png)) still say "…the payroll never shows up on a block explorer". Make sure the branch you demo from has it.
3. **Onboarding is too long to show live.** Save the recovery kit, then lock with a passkey (the 3-word backup check is gone since D-44, so it is shorter than it was). Pre-stage it (Beat 2). Consider a "demo account" restore, or skipping straight to Register for a pre-made profile.
4. **The mock wallet can't sign a pay run** ("Not sent: the approval didn't go through"), so the pay run is the one beat with no offline fallback that actually sends. Keep the live tx link ready.
5. **The invite's org name doesn't match in mock mode.** The link carries `org=Acme Labs`, but onboarding shows "Invited by Acme Robotics" (the mock fixture). Check that the live path shows the employer's own org.
6. **After an exit or a send, mock balances aren't refreshed.** An address that just sent 80 of its 100 USDC still shows 100 (rechecked 2026-09-26). Confirm it's mock-only.
7. ~~**Guard copy exposes a raw pay-run tx hash.**~~ Done (D-41): hashes in guard copy render short (`0x681f…9e2a`) and link to Basescan outside mock mode.
8. **Run pages and Basescan:** live runs already link each step's tx (Tx column), and the **What coworkers see** panel links each landed tx (D-41). Mock runs never send, so they show "—" and a labelled preview instead.
