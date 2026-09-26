# Stage demos

Three short scripts. Each beat is **Do / Say / Fallback**. If a live step stalls for more than ~8 s, take the fallback and keep talking.

| Script | Length | Story |
| --- | --- | --- |
| [finalist.md](finalist.md) | ~3 min | The product: a company pays people and an AI agent, privately |
| [worldid.md](worldid.md) | ~2 min | World ID: recovery works for you, and fails for a thief |
| [ens.md](ens.md) | ~2 min | ENS: names instead of wallets |

Q&A in plain language: [how-it-works.md](how-it-works.md).

Links: company app https://soapay.up.railway.app/ · employee app https://soapay.up.railway.app/app/

## Setup checklist (all three scripts)

1. **Terminal:** in the checkout that has `contracts/.env` and the `scripts/*.local.*` files, run `pnpm install && pnpm build`.
2. **Employer wallet:** make a fresh MetaMask account, then run `pnpm demo:bootstrap <employer-address>`. It sends 0.05 Base Sepolia ETH (`--eth 0.5` for more), gets mock USDC, seeds the company roster, and prints the next clicks. Safe to run again. `--dry` only looks.
3. **Employer profile** (browser, MetaMask): log in to the company app, decline MetaMask's smart-account switch, create the vault with **Wallet signature**, **Pay run → Import CSV** (the roster file the bootstrap printed), **Settings → Chunk size 500**, then **Back up now**.
4. **Employee profile:** a fresh browser profile with no Soapay data, and Touch ID. Used for the live sign-up.
5. **Coworker profile:** employee app → **Restore from recovery phrase** → open `scripts/maya-ml.recovery-kit.local.txt` → set a passkey.
6. **Phone:** World App open and verified (Proof of Human). The thief beat uses the script, no second phone.
7. **Agent terminal:** `pnpm demo:agent init` once (makes the agent's phrase, never shown), then check `pnpm demo:agent status` answers. The live agent (`pnpm demo:agent-live`) runs on this laptop's logged-in `claude` CLI: no API key needed; check `claude -p "hi"` answers.
8. **Thief terminal:** once, `pnpm demo:setup-recovery` (sets up `sam-demo`), then `pnpm demo:attacker-worldid sam-demo --setup` and scan its QR with your World App (links sam-demo to a World ID, so the refusal is "a different person"). Type `pnpm demo:attacker-worldid sam-demo`; don't run it yet.
9. **Fresh labels:** the live beats claim new names, so they must be unclaimed: `billing-agent` (the agent) and `alex-meridian` (the World ID sign-up). The bootstrap checks them; or `curl https://soapay.up.railway.app/api/names/<label>` → `not_found`. Once used, pick a new label (`billing-agent2`, `alex-meridian2`).
10. **Tabs warm:** Basescan and Sepolia Etherscan (pass their Cloudflare check by hand). Do Not Disturb on.
11. **Merge freeze:** no merges to `main` an hour before. Every merge redeploys the live API.
12. **Rehearse once** on throwaway labels and screen-record it. The recording is every fallback. After the demo: `pnpm demo:attacker sam-demo --restore`.

## Good to know

- **Names in the scripts** are the seeded ones (`maya-ml` is the coworker). If seeding had to pick a variant (`maya-ml2`), use the name the bootstrap printed.
- **One pay run, one transaction.** A MetaMask (plain account) pay run goes through `StealthDisperse`: two prompts, approve then pay, and one transaction for up to **350 lines**. The seeded company (about 12 people at 500 USDC chunks) is about 125 lines: one transaction. A run of 10 to 125 people fits in one transaction as long as it stays under 350 lines. Only bigger runs are split, and then the lines are sorted globally so no transaction maps to one person.
- **The API allows 3 registrations per IP per hour.** Don't rehearse sign-ups from the venue network in the last hour.
- **Offline fallback:** `pnpm --filter @soapay/recipient dev:mock` runs the employee app on mock data.

The older scripts ([demo-desktop.md](../demo-desktop.md), [demo-flow.md](../demo-flow.md)) are superseded by these.
