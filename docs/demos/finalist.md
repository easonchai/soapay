# Finalist demo (~3 min)

The product story: a company pays its people and an AI agent in USDC, and no coworker can see who earns what. Setup: [README.md](README.md).

**On screen:** the Employer profile (company app, MetaMask) and the agent terminal. Company: **Meridian Labs**, ten people already on payroll.

| # | Beat | Time |
| --- | --- | --- |
| 1 | The company app | 0:00–0:30 |
| 2 | The payroll that's already there | 0:30–0:45 |
| 3 | Add an AI agent | 0:45–1:30 |
| 4 | Pay run | 1:30–2:05 |
| 5 | The agent spends | 2:05–2:45 |
| 6 | Close | 2:45–3:00 |

## 1. The company app (0:00–0:30)

- **Do:** **Pay run**. Point at the roster, then at **Denominated payouts** and **Chunk size 500 USDC**.
- **Say:** "This is Meridian Labs' payroll, in USDC on Base. Salaries are paid in equal chunks of 500 USDC. Every chunk goes to a fresh address that only the employee can open."
- **Say:** "Why chunks? If Maya gets 5,250 on-chain, her coworkers can spot her line. When every line is 500, the amounts point to nobody."

## 2. The payroll that's already there (0:30–0:45)

- **Do:** **Recipients**. Scroll the list: names like `maya-ml.soapay.eth`, each **Verified**.
- **Say:** "Every employee is a name, not a wallet. The app looked each name up once and pinned its keys."
- **Fallback:** if the list is empty, **Pay run → Import CSV** → the roster file.

## 3. Add an AI agent (0:45–1:30)

- **Do (company app):** **Recipients → Invite employee**: name `billing-agent`, salary `1000`, organisation `Meridian Labs` → **Sign and create link** (sign in MetaMask) → **Copy link**.
- **Do (agent terminal):** `pnpm demo:agent-live join` → paste the link at the prompt.
- **Say:** "Our billing agent gets the same invite a person gets. It's a real Claude agent using the Soapay MCP server: it makes its own keys and claims its own name."
- **While the agent works, say:**
  - "The name holds one public key, the stealth meta-address (ERC-6538). For every payment we derive a brand-new address from it (ERC-5564). Only the owner can find and open it."
  - "Those addresses hold no ETH. On the first spend, EIP-7702 turns the address into a smart account (Simple7702Account), and a paymaster pays the gas."
  - "The whole pay run is one transaction through our StealthDisperse contract, up to 350 lines. It holds no money and keeps no state."
- **Do:** back in the company app, `billing-agent.soapay.eth` appears in **Recipients** within ~5 s.
- **Fallback:** `pnpm demo:agent join` (same MCP tools, scripted, no model). Last resort: the pre-joined agent from rehearsal: "it joined before we came on."

## 4. Pay run and two views (1:30–2:15)

- **Do:** **Start pay run** → **Resolve names** (every row **Verified**) → **Review**.
- **Say (read the headline):** "About 60,000 USDC to 12 people, on about 125 fresh addresses. On chain it's 125 payments of about 500 USDC to 125 strangers."
- **Do:** **Approve and send** → MetaMask twice (approve, then pay) → open the Basescan link.
- **Say:** "One transaction. Anyone can see it, and nobody can tell whose salary is whose."
- **Do (Employee profile, Lena):** **Payments → Rescan → Pay runs → Two views → My view**.
- **Say:** "This is Lena. Her key finds her lines in that transaction and lights them up."
- **Do (Coworker profile, Maya):** same run → **Coworker view**.
- **Say:** "This is Maya, a coworker in the same batch. She sees every line and every amount, and the owner of each one is unknown. She knows her own pay and still can't find Lena's."
- **Fallback:** the rehearsal run's Basescan tab and its Two views.

## 5. The agent spends (2:15–2:45)

- **Do (agent terminal):** `pnpm demo:agent-live spend 0.5 maya-ml`.
- **Say:** "The agent scans the pay run and finds its two lines among everyone's. Now it pays Maya, by name, 0.5 USDC."
- **Do:** it shows the plan, confirm, then the Basescan link and "source address … ETH: 0".
- **Say:** "It paid from an address holding zero ETH. The first spend upgraded that address with EIP-7702, and the gas was sponsored. Maya receives it at another fresh address."
- **Fallback:** `pnpm demo:agent spend 0.5 maya-ml` (scripted). Last resort: the recorded spend on Basescan.

## 6. Close (2:45–3:00)

- **Say:** "One name, a fresh address every payday, for people and for agents. Coworkers see the batch, never the salaries."

## If asked

Full answers: [how-it-works.md](how-it-works.md).

- **Batch size?** A MetaMask pay run is one `StealthDisperse` transaction for up to 350 lines. Our run is about 125 lines, so one transaction. Bigger runs are split into several, sorted globally so no transaction is one person's pay.
- **Who is the adversary?** A coworker in the same batch. The employer is trusted and knows everything.
- **Mainnet?** Real USDC, and Circle's paymaster takes the gas fee in USDC.
