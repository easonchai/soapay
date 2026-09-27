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
4. **Employee profile (Lena, already onboarded):** a browser profile → employee app → **Restore from recovery phrase** → open `scripts/lena-ml.recovery-kit.local.txt` → set a passkey. Shows **My view** in the finalist demo. (Nobody signs up live there; the agent is the live onboarding.)
5. **Coworker profile (Maya):** another browser profile → same, with `scripts/maya-ml.recovery-kit.local.txt`. Shows **Coworker view**.
6. **Phone:** World App open and verified (Proof of Human). The thief beat uses the script, no second phone.
7. **Agent terminal:** `pnpm demo:agent init` once (makes the agent's phrase, never shown), then check `pnpm demo:agent status` answers. The live agent (`pnpm demo:agent-live`) runs on this laptop's logged-in `claude` CLI: no API key needed; check `claude -p "hi"` answers.
8. **Thief terminal:** once, `pnpm demo:setup-recovery` (sets up `sam-demo`), then `pnpm demo:attacker-worldid sam-demo --setup` and scan its QR with your World App (links sam-demo to a World ID, so the refusal is "a different person"). Type `pnpm demo:attacker-worldid sam-demo`; don't run it yet.
9. **Fresh labels:** the live beats claim new names, so they must be unclaimed: `billing-agent` (the agent, finalist and ENS demos) and `alex-meridian` (only for the World ID demo's live sign-up, in a third, empty browser profile). The bootstrap checks them; or `curl https://soapay.up.railway.app/api/names/<label>` → `not_found`. Once used, pick a new label (`billing-agent2`, `alex-meridian2`).
10. **Tabs warm:** Basescan and Sepolia Etherscan (pass their Cloudflare check by hand). Do Not Disturb on.
11. **Merge freeze:** no merges to `main` an hour before. Every merge redeploys the live API.
12. **Rehearse once** on throwaway labels and screen-record it. The recording is every fallback. After the demo: `pnpm demo:attacker sam-demo --restore`.

## Good to know

- **Names in the scripts** are the seeded ones (`maya-ml` is the coworker). If seeding had to pick a variant (`maya-ml2`), use the name the bootstrap printed.
- **One pay run, one transaction.** A MetaMask (plain account) pay run goes through `StealthDisperse`: two prompts, approve then pay, and one transaction for up to **350 lines**. The seeded company (about 12 people at 500 USDC chunks) is about 125 lines: one transaction. A run of 10 to 125 people fits in one transaction as long as it stays under 350 lines. Only bigger runs are split, and then the lines are sorted globally so no transaction maps to one person.
- **Rate limits are off on the testnet API**, so rehearsing sign-ups from the venue network is fine.
- **Both kit files** (`lena-ml`, `maya-ml`) come from `pnpm demo:seed-company` (the bootstrap runs it). They contain recovery phrases: never commit or share them.
- **Offline fallback:** `pnpm --filter @soapay/recipient dev:mock` runs the employee app on mock data.


## Live links and references

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

**CLI recording (pitch only):** `DEMO_REPLAY=1 scripts/demo-pluggable.sh` replays the recorded "plug it into anything" run ([`demo-screens/beat4-pluggable-live.txt`](../demo-screens/beat4-pluggable-live.txt)); `DEMO_DRY=1` plans without sending.

**Exit (roadmap evidence, not shown on the testnet demo):** the 2026-09-26 live exit with Circle USDC: [pay](https://sepolia.basescan.org/tx/0xbd9d0001b4fe5fbee969003921b43a82608e7e3d0748a3fcd347f33244a3799b) → [burn](https://sepolia.basescan.org/tx/0x78fa2c713458f30879096a4d79a024f4fc0eab55aceffc8789111beaf19b6c89) → [mint](https://sepolia.etherscan.io/tx/0x5feec0c529b0b424b98c3b4c28f00191d20e7ca25b52b5d8d41627e7779436ab) → [deposit](https://sepolia.etherscan.io/tx/0xa7c6ff5f59c0c231b53df82859fca712798d398e9a907aefba778a5495d013e0) → [direct withdrawal](https://sepolia.etherscan.io/tx/0xed9235c87f7643bde048cd9e29c8abebe989a64016a628c85faa7ed5724fc672). Details: [testnet-deployment.md](../testnet-deployment.md).

**Recovery scripts (D-55):** `scripts/demo-setup-recovery.ts`, `scripts/demo-attacker.ts` (`--restore`, `DEMO_DRY=1`), `scripts/demo-recovery-check.ts`. Env: `API_URL` (default the Railway API), `ENS_RPC_URL`, `RPC_URL`, `SOAPAY_DEMO_FILE` (the phrase file), `SOAPAY_ENV_ROOT` (where the git-ignored `contracts/.env` and `apps/api/.env` live, for the stolen registrant's gas top-up). Nothing prints a phrase or a key. Honest line if asked: World ID protects **future** salary; a stolen phrase can still spend what sam already received, so move funds and rotate as soon as a leak is suspected.
