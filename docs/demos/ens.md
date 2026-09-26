# ENS demo (~2 min)

Names instead of wallets: you pay `maya-ml.soapay.eth`, and every payment still lands on a fresh address. Setup: [README.md](README.md).

**On screen:** a terminal and the Employer profile (company app). Names live on ENSv2 on Sepolia; payments on Base Sepolia.

| # | Beat | Time |
| --- | --- | --- |
| 1 | What a name holds | 0:00–0:50 |
| 2 | The company app resolves and pins | 0:50–1:25 |
| 3 | Agents get names too | 1:25–1:55 |
| 4 | Close | 1:55–2:00 |

## 1. What a name holds (0:00–0:50)

- **Do (terminal):** `pnpm demo:ens maya-ml`
- **Point at, top to bottom:**
  - **`stealth` text record:** `st:eth:0x…`, two public keys (spending and viewing). "That's all a payer needs."
  - **No `addr`:** "On purpose. A normal wallet can't pay this name to one fixed address that coworkers could watch."
  - **Its own resolver, with scoped write permission:** "Each employee has their own resolver. Only their key can change `stealth`, and nothing else."
  - **ERC-6538 cross-check:** "The same meta-address is in the ERC-6538 registry on Base. The payer checks both match."
  - **Fresh addresses:** "Derived just now from that one record. Every payment gets a new one (ERC-5564)."
- **Fallback:** Maya's resolver on Sepolia Etherscan, or the **Name** tab in the employee app.

## 2. The company app resolves and pins (0:50–1:25)

- **Do (Employer):** **Recipients → Add by name** `dividend-ana.soapay.eth` (any live name not on the roster yet), salary `500` → **Resolve and pin** → the row shows **Verified**.
- **Say:** "The company adds a name, not an address. The app resolves it once and pins the keys."
- **Do:** **Start pay run → Resolve names** → rows read **Verified · N fresh addresses**.
- **Say:** "Every run re-checks each name against its pin. If a record changes without the owner's World ID, the line is blocked."

## 3. Agents get names too (1:25–1:55)

- **Do (terminal):** `pnpm demo:ens billing-agent` (the agent from the finalist demo; or any agent name from rehearsal).
- **Point at:** the same `stealth` record, plus the ENSIP-26 records `agent-context` (what the agent does) and `agent-endpoint[…]` (where to reach it).
- **Say:** "An agent claims its name through the same invite. Next to its payment key, ENSIP-26 records say what it does and where to reach it. Other agents can find it and pay it by name."

## 4. Close (1:55–2:00)

- **Say:** "One ENS name. Anyone can pay it, and no one can follow the money."

## If asked

Full answers: [how-it-works.md](how-it-works.md).

- **Who owns the name?** The employee holds it, but can't transfer it. The company can revoke it when someone leaves.
- **Why pin?** ENS decides where salaries go, so the payer pins the keys and treats any change as suspicious until the owner's World ID backs it.
