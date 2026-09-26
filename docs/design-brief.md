# Soapay design brief

## What Soapay is

Soapay: one name, infinite addresses. Get paid on-chain without publishing your bank statement.

Every wallet address on Ethereum is a public bank statement. Soapay gives a person one static name (an ENS name) that lands every incoming payment on a fresh address only they can open. Nothing on-chain links one payment to the next or to the person. They spend from those addresses without topping up gas, and when money has to reach somewhere identifiable, Soapay routes it through a compliant privacy pool.

First customers are groups paying groups: companies paying salaries and contractors, DAOs paying contributors and grants. Full PRD: https://github.com/easonchai/soapay/blob/main/docs/PRD.md

## Who uses it

- **Recipient.** An employee or contributor. Sets up once, then opens the app to see what arrived and to spend. Not necessarily crypto-native. Must feel safe.
- **Sender.** A finance or ops person at a company or DAO. Pastes names and amounts, signs one transaction, moves on. Cares about correctness and audit trail, not privacy features.
- **Operator.** Technical person running the self-hosted gateway. Config screens only.

## Brand direction: institutional

Soapay should feel like the back office of a private bank, not a crypto app. The privacy is a property of the system, not a selling point shouted at the user. Discreet, exact, calm.

Words we want people to use: precise, trustworthy, quiet, serious, engineered.

Words we never want: fun, playful, degen, futuristic, flashy.

Reference feel, not to copy: Mercury's dashboard restraint, Stripe's documentation clarity, the typography of a Swiss bank's annual report, Bloomberg's density without its clutter.

You own palette, type, logo and system. Constraints:

- Light theme is primary. Dark theme required as a full peer, not an afterthought.
- WCAG AA contrast everywhere, including on every status colour.
- Amounts and addresses in a monospace or tabular-figure face. Numbers must align in columns.
- No gradients as decoration, no glass effects, no 3D coins, no mascots, no neon.
- Motion is functional only: state changes, progress, confirmation. Nothing ambient.

## Deliverables in priority order

1. **Brand.** Wordmark and logomark, palette for both themes, type pairing, icon style, one-page brand sheet.
2. **Design system.** Figma tokens (colour, type, spacing, radius, elevation), core components with variants and states: buttons, inputs, tables, address chip, amount cell, status pill, chain badge, modal, toast, empty and error states.
3. **Recipient app screens.** Highest priority. Listed below.
4. **Sender app screens.**
5. **Marketing site.** Landing plus a documentation shell.
6. **Gateway operator settings.** Lowest priority, functional only.

## Recipient app screens

Web first, must work at phone width.

- **Onboarding.** Create keys, back up seed (a ceremony that makes people actually write it down), choose or link an ENS name, register on-chain, choose trust mode. Ends with one thing to copy: the name.
- **Trust mode chooser.** Three options: client-side only, self-hosted gateway, Soapay-hosted gateway. Each explains in one sentence who can see what. The hosted option must state plainly that Soapay sees incoming payments and cannot spend them.
- **Home / ledger.** Every payment received, newest first: amount, token, from-name if known, date, fresh-address indicator, status (announced, received, ready to spend, delegated, spent, exited). A single total balance at the top that is the sum of many addresses.
- **Spend.** Pick a destination and amount. The app picks which addresses to draw from and shows it. If the choice links previously unlinked addresses, a clear warning before signing. If the destination is labelled as identifiable, the flow offers the privacy-pool exit first.
- **Labels.** Mark addresses as main wallet, exchange, or other. Explain in one line why this matters.
- **Exit via privacy pool.** Multi-step, slow, costs mainnet gas. Show the steps and where the user is, with honest timing.
- **Audit.** For gateway modes: list of addresses the gateway issued, each checked against the app's own derivation. Green when all match. Loud when one does not.
- **Backup and recovery.** Restore from seed. Rebuild ledger from chain with a progress state.
- **Settings.** Name, trust mode, gateway, chain, theme.

## Sender app screens

Desktop first.

- **Pay run.** Table of name, amount, token. Paste from a spreadsheet. Live resolution status per row: resolving, resolved, failed. Denominated payouts toggle with chunk size and a preview of how many lines the batch becomes.
- **Review and sign.** What will be sent, to how many fresh addresses, total, gas. One signature. For multisig senders: export a Safe transaction instead.
- **History.** Past runs, each expandable to its lines, with the transaction link. This is the sender's audit trail.
- **Recipients.** Saved groups of names. No addresses stored anywhere in this app.

## Marketing site

- **Landing.** One hero idea: the public bank statement. Show a real-looking block explorer view of a batch payment with names and amounts exposed, then the same batch through Soapay. Keep it to one scroll.
- **How it works.** Three roles, three steps each. Diagram style should match the brand, not crypto-infographic style.
- **Trust page.** The three trust modes side by side, honest about each.
- **Docs shell.** Sidebar plus content, for the SDK and gateway docs.

## Things the UI must get right

- A fresh address is the product. Every received payment should visibly be on its own never-seen-before address. Make that legible without explaining cryptography.
- Linking is the risk. Any action that links addresses must be visible before it happens and reviewable after.
- Trust mode is always visible somewhere in the recipient app, never buried.
- Addresses are truncated with a copy action and a full-view on hover or tap. Never wrapped mid-string.
- States are honest. Announced is not received. Bridging takes minutes. The pool takes longer. Show it.
- Empty states teach. First-time ledger with zero payments should tell the user exactly what to send to whom.

## Hand-off

Figma file with tokens as variables, components with variants, both themes, all screens at desktop and phone width for the recipient app. Exports for logo in SVG. A short notes page on any decision you made that the PRD did not cover.

## Questions for you before you start

1. What do you need from us beyond the PRD and this brief?
2. Do you want to propose two brand directions first, or go straight to one?
3. Timeline for brand, then system, then recipient app screens?
