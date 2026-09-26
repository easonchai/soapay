# @soapay/mcp

A stdio [MCP](https://modelcontextprotocol.io) server that gives an AI agent a Soapay identity: a name like `ledger-bot.soapay.eth` that anyone can pay privately, and a wallet that pays other names through stealth addresses. It is a thin layer over `@soapay/sdk` and the Soapay API ([spec §8](../../docs/mvp-spec.md)).

## Install

```bash
pnpm install && pnpm --filter @soapay/mcp build    # esbuild bundle → apps/mcp/dist/index.js

claude mcp add soapay \
  -e API_URL=http://localhost:8787 \
  -e RPC_URL=https://sepolia.base.org \
  -e ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
  -e AGENT_MNEMONIC="twelve words …" \
  -e AGENT_PAYER_PRIVATE_KEY=0x… \
  -e MAX_PER_CALL_USDC=5 -e MAX_PER_DAY_USDC=20 \
  -- node /abs/path/apps/mcp/dist/index.js
```

The server is bundled because the ScopeLift SDK can't load in plain Node. Every variable is listed in [`.env.example`](.env.example):

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_URL` | `http://localhost:8787` | Soapay API: `/register`, `/names`, `/announcements`, `/uniswap`, and on Base Sepolia `/paymaster` and `/faucet` |
| `CHAIN_ID` | `84532` | Base Sepolia |
| `RPC_URL` / `ENS_RPC_URL` | public RPCs | Base Sepolia / Ethereum Sepolia (ENSv2) |
| `BUNDLER_URL` | `https://public.pimlico.io/v2/84532/rpc` | ERC-4337 bundler for spends |
| `PAYMASTER_URL` | `${API_URL}/paymaster` | Base Sepolia: the ERC-7677 sponsorship proxy that pays spends' gas (D-52). Unused on Base mainnet (Circle paymaster, gas in USDC) |
| `PAY_TOKEN` | unset | Base Sepolia only: the pay token. Unset = Soapay's mock USDC `0x028D…14Bb` |
| `STEALTH_DISPERSE` | `0x6B7a…39CA` | The deployed StealthDisperse |
| `AGENT_MNEMONIC` | unset | The agent as recipient (spending, viewing and registrant keys) |
| `AGENT_PAYER_PRIVATE_KEY` | unset | The agent as payer: an EOA with USDC and a little ETH (on Base Sepolia, `get_test_funds` drops test USDC once) |
| `STATE_DIR` | `~/.soapay-mcp` | `state.json` (0600): daily cap counter, pinned meta-addresses, guard graph. No keys |
| `MAX_PER_CALL_USDC` / `MAX_PER_DAY_USDC` | `5` / `20` | Caps |
| `PAYEE_ALLOWLIST` | unset | Comma-separated names. When set, only these names can be paid, and raw addresses are refused |
| `KNOWN_PAYERS` | unset | Payers whose payments `scan` marks as known (the agent's own payer always is) |
| `IDENTIFIABLE_ADDRESSES` | unset | Addresses the guard treats as the owner's main wallet (the payer always is) |

## Tools

| Tool | What it does |
| --- | --- |
| `whoami` | Name, meta-address, payer address with USDC/ETH balances, remaining caps |
| `resolve_name(name)` | ENSv2 `stealth` record, cross-checked against the ERC-6538 registry on Base |
| `create_agent_identity(label?, invite?, description?, capabilities?, endpoints?)` | Sponsored ERC-6538 registration, then `<label>.soapay.eth` with ENSIP-26 records. With `invite` (an employer's invite link or code), the label comes from the invite and the employer's app sees it as joined |
| `pay(payments[{name, amount}])` → `pay(confirm)` | One pay run through StealthDisperse. The plan shows lines, total, txs and gas; the confirm approves the exact total, waits until the allowance is visible, then pays |
| `scan` | Received payments: real on-chain balances, payer, ledger flags |
| `balance` | Total received, grouped into clusters of addresses already linked |
| `spend(to, amount)` → `spend(confirm)` | Sends received USDC to an address or a name. One userOp per source address (7702); gas is sponsored on Base Sepolia and paid in USDC by the Circle paymaster on Base. To a name, every part goes to its own fresh stealth address with an announcement |
| `swap_in_place(tokenOut, amount)` → `swap_in_place(confirm)` | Uniswap swap that stays inside one stealth address |
| `get_test_funds` | Base Sepolia only (not listed elsewhere): the payer wallet's one-time drop of test USDC from the API |

Example prompts:

- "Create an agent identity called ledger-bot that pays contractors."
- "Join Meridian Labs payroll with this invite: https://…/#/join?code=0x…&label=invoice-agent&org=Meridian%20Labs"
- "Pay alice.soapay.eth 2 USDC and bob.soapay.eth 1.5 USDC." (the agent shows the plan, then confirms)
- "What did I receive?" (`scan`) · "What's my balance?" (`balance`)
- "Send 1 USDC to carol.soapay.eth." · "Swap 0.5 USDC to ETH in place."

## Joining an employer's payroll with an invite

An employer invites an agent exactly like an employee: in the company app, **Recipients → Invite employee**, type the label (say `invoice-agent`), then **Copy link**. The link reserves that label on the API for its lifetime, so nobody else can claim it. Paste the link to the agent in chat; it calls `create_agent_identity({ invite: "<link>" })`.

- The tool accepts the full link (`<recipient app>/#/join?code=0x…&label=…&org=…`, as `buildInviteLink` in the SDK builds it) or the bare 0x-prefixed 32-byte code.
- It looks the invite up with `GET /invites/:codeHash`. The **API's reserved label is the truth**; the link's `label` is only a hint. `label` may be omitted. If the agent passes a different label, the tool fails with `invite_label_mismatch` before anything is registered.
- The claim goes to `POST /names` with `inviteCode`, which marks the invite claimed in the same transaction as the name. The company app's invite poller then sees `claimed`, resolves the name, and pins its meta-address like any employee's: the row flips to joined.
- Errors: `invalid_invite` (not a join link or code), `invite_not_found`, `invite_claimed` (used by someone else), `invite_expired`. Re-running after a successful join returns the existing name (`created: false`).
- The code is a bearer secret. It is sent only to the API and never appears in tool output or logs (those carry the code hash).

## Guardrails

- **Two steps for any value move.** `pay`, `spend` and `swap_in_place` only return a plan, even with `dry_run: false`. Executing takes a second call with `{ confirm: planId }`. Plans live in memory, expire after 10 minutes, and are single-use. A restart drops them.
- **Caps.** `MAX_PER_CALL_USDC` applies to pay, spend and swap. `MAX_PER_DAY_USDC` (per UTC day, stored in `state.json`) applies to pay and spend. Both are checked at the dry run and again at the confirm.
- **Payee allowlist.** When `PAYEE_ALLOWLIST` is set, both `pay` and `spend` only accept listed names.
- **Pinning.** A name's meta-address is pinned the first time it is used. If it changes later, `pay` and `spend` fail with `pin_changed` until the operator removes the pin from `state.json`. The pin is checked again at the confirm.
- **Consolidation guard.** `spend` runs the SDK's `planSpend`. A `block` returns no planId and can't be overridden: the tools have no override parameter. A `warn` (for example, merging clusters) comes back in the plan so the agent can decide. The guard is checked again at the confirm, and the graph records every spend. The agent's payer wallet counts as identifiable.
- **Keys.** Keys come only from env and never appear in any tool output. Stealth keys are derived per call and then dropped. Plans hold only public data. Logs go to stderr as JSON; addresses are cut to `0x1234…abcd`, and anything key-sized or mnemonic-like is removed.

## ENSIP-25 / ENSIP-26 records

`create_agent_identity` claims the name through `POST /names` with an `agent` object. The API's ENSv2 issuer writes the records once, in the new resolver's `initialize`, next to `stealth` and `soapay:registrant`. That is the same atomic transaction as a normal name.

| Key | Value | Standard |
| --- | --- | --- |
| `agent-context` | JSON: name, description, capabilities, and how to pay the agent (ERC-5564 via the `stealth` record) | ENSIP-26 (required entry point) |
| `agent-endpoint[<protocol>]` | URL (`mcp`, `a2a`, `web`, …), from `endpoints` | ENSIP-26 |
| `agent-registration[<ERC-7930 registry>][<agentId>]` | `"1"` | ENSIP-25 |

Choices and limits:

- **Set at issuance, by the issuer.** Under our EAC model, the registrant key can only write `stealth`. Instead of granting it more text roles, the records ride along with issuance: `issue()` in the SDK and `POST /names` accept an optional, validated `agent` object. Without it, the calldata and the resolver salt are byte-identical to before. The records are immutable afterwards (`agent_immutable` on an update). Changing them means a new name.
- **Not signed.** The NameClaim signature doesn't cover `agent`, so the records describe the agent but carry no authority. They can never touch `stealth` or `soapay:registrant`.
- **ENSIP-25 is supported, not used by default.** The SDK and API accept `registrations: [{registry, agentId}]`, but ENSIP-25 only verifies once a live registry (such as ERC-8004) lists the name under that id. We don't register the agent in one, so `create_agent_identity` doesn't set the record.

Live (2026-09-25): `mcp-agent-7c1e.soapay.eth` on ENSv2 Sepolia resolves `agent-context` and `agent-endpoint[web]` through viem's `getEnsText`.

## Development

```bash
pnpm --filter @soapay/mcp test        # vitest: tools with a mocked chain/API, guardrails, in-memory MCP client
pnpm --filter @soapay/mcp typecheck
pnpm --filter @soapay/mcp dev         # tsx, unbundled
```
