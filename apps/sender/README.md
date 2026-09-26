# @soapay/sender

Employer app: keep a roster of ENS names → salaries, re-verify every name before each run, and pay the run
in stealth USDC on Base. Static Vite + React SPA; the roster and run history are encrypted in the browser
(`src/lib/vault.ts`) and never leave it.

```sh
cp .env.example .env         # every value is optional
pnpm --filter @soapay/sdk build
pnpm --filter @soapay/sender dev            # http://localhost:5174
VITE_MOCK_ENS=1 pnpm --filter @soapay/sender dev   # demo names, mock attester, demo wallet
pnpm --filter @soapay/sender test && pnpm --filter @soapay/sender typecheck && pnpm --filter @soapay/sender build
```

## Pay paths

Chosen per connected wallet by the SDK's `selectPayPath` (`packages/sdk/src/paypath.ts`). CK's non-atomic
"sequential" fallback (announce, then transfer, one tx each) is dropped (PRD invariant 3):

| Wallet | Path |
| --- | --- |
| Smart account / 7702 wallet reporting EIP-5792 atomic batching | one `wallet_sendCalls` per chunk: `[USDC.transfer, Announcer.announce] × N` |
| Plain EOA | `StealthDisperse`: approve the exact total, then one `pay` per chunk |
| Safe | Transaction Builder export through `MultiSendCallOnly` (never `MultiSend`) |

When `VITE_STEALTH_DISPERSE` is unset (and Settings has no address for the chain) the app shows an
**"EIP-5792 path only"** banner: plain EOAs can't pay until the contract is deployed and configured.

Binding invariants (CLAUDE.md): every line of a run is derived first, sorted globally by stealth address and cut
into near-equal chunks of ≤350 lines (never per employee); a fresh ephemeral key per line; exact-total approvals;
only the **pinned** meta-address is paid. A changed meta-address is auto-accepted only with a MetaRotation
attestation signed by the pinned `VITE_ATTESTER` (docs/mvp-spec.md §2.1); otherwise the line is blocked until
the employer re-approves. Retries re-verify and re-derive; stored stealth addresses are records, never inputs.

## Invite links

docs/mvp-spec.md §7. On the Recipients page, **Invite employee** takes a label, an amount and an optional
organisation name. The app generates a 32-byte code, has the connected wallet sign the `Invite` typed data
(`signInvite` from `@soapay/sdk`; smart wallets sign through ERC-1271), POSTs `/invites` (which reserves the
label) and shows `${VITE_RECIPIENT_URL}/#/join?code=…&label=…&org=…` with a copy button and a QR code.

- The code is stored only in the encrypted vault (`invites` slot). The API only ever sees `keccak256(code)`.
- The row shows **Invited (pending)** while `useInvitePolling` (mounted once in `App.tsx`, every page)
  polls `GET /invites/:codeHash` every 5 s.
- On `claimed` the employee is enrolled through the **same resolve-and-pin path** as a manual enrollment
  (`enrollEmployee`); the API's answer is never trusted as a meta-address. If resolution fails (records not
  written yet) the row shows "Claimed, waiting to verify" and is retried on the next poll.
- On `expired` (or an unknown code) the row offers **Re-invite**: a new code and signature replace the old row.
- Needs `VITE_API_URL` (and a connected wallet). In mock mode (`VITE_MOCK_ENS=1`) an in-memory API flips each
  invite to claimed after ~4 s and a throwaway key signs, so the whole flow can be clicked through offline.

Logic: `src/lib/invites.ts` (create, poll, apply outcomes, HTTP and mock APIs); hooks: `useInvites()` (form
actions, rows, the link just created) and `useInvitePolling()`; view: `src/pages/InvitesPanel.tsx`,
`src/ui/QrCode.tsx`.

## Screens (CK's Direction A · Ledger design)

The presentation is CK's company app on `@soapay/ui` (TopBar, PageHead, NavyPanel, Toggle, FreshMark, Pill,
Copy, Toaster, motion); the engine is ours. Flow: **Landing** (wallet Login; pick a connector, incl. the demo
wallet in mock mode) → **vault gate** (create/unlock the encrypted roster + history) → tabs:

| Tab | Page | Hooks |
| --- | --- | --- |
| Pay run (`#/pay`) | `PayRunPage`: the roster as the run table; **Resolve names** re-verifies every pin; blocked lines (record changed without a World ID attestation) show **Re-approve**; attested pins show **Re-verified by World ID**; denominated payouts (chunk size, exact/carry); **Paste rows** / CSV import only bulk-enrolls `name, salary` into the roster (roster only, owner decision 2026-09-26: raw `st:eth:` meta-addresses and plain addresses are rejected); optional **Run label** stored on the run record. **Review** → `ReviewPage` (plan, pay path, gas, warnings, Sign and send, or Safe export → `SafeExportPage`) | `usePayRun`, `useRoster`, `useWallet`, `usePayPath` |
| History (`#/history`, `#/runs/<id>`) | `HistoryPage` (stats, runs, names → amounts, Export CSV) and `RunDetailPage` (steps, recheck, never-sent, retry, and **What coworkers see**: each landed tx rebuilt from its receipt by SDK `payRunBatchFromReceipt`, names beside it; D-41) | `useHistory`, `useRunActions`, `useRunOnChain` |
| Recipients (`#/roster`) | `RecipientsPage`: add by name, **Invite employee** (`InvitesPanel`: link + QR, pending rows, re-invite), list with record status, detail with pinned record, re-approval, pause/remove, and every paid wallet with its **live USDC balance** and spend status (unspent / partly spent / withdrawn) | `useRoster`, `useInvites`, `useWalletBalances` |
| Settings (`#/settings`) | `SettingsPage`: company name (top bar, invite org), chain / StealthDisperse / RPCs, attester, vault lock/delete | `useSettings`, `useStore` |

CK's company view (employee → stealth wallets → live balances) is derived from our encrypted run records
(`src/lib/wallets.ts`); his plaintext localStorage stores are not used. The company name is plain
localStorage (`soapay:org`), as are the pay-run draft toggles (`soapay:payrun`).

Env: CK's `VITE_STEALTH_DISPERSE_ADDRESS` is accepted as an alias (`VITE_STEALTH_DISPERSE` wins);
`VITE_OTHER_APP_URL` sets the top bar's **Receive** link (default `VITE_RECIPIENT_URL`). `?motion=off` disables
animations (screenshots, QA).

## How to plug in another UI

The app is three layers. Only the last one is visual.

1. **`src/lib/*`**: framework-free logic (roster pins, run planning and records, execution state machine,
   Safe export, vault, CSV, amounts, wallet adapters over `wagmi/actions`, the per-employee wallet view). Unit-tested in `test/`.
2. **`src/hooks/*`**: React hooks that own all state and side effects. They render nothing.
   - `StoreProvider` / `useStore()` (`store.tsx`): vault phase, roster, run history, `executeRun`.
   - `useRoster()`: enroll, CSV import, re-verify, re-approve, pause, amount edit, mock rotation.
   - `useInvites()` / `useInvitePolling()`: invite links (create, re-invite, remove) and claimed → auto-enroll.
   - `usePayRun()`: `verify()` → `preview(denomination)` → `execute()` or `exportSafe(safe)`.
   - `useRunActions(id)` / `useHistory()`: status, names → amounts report, `recheck`, `retry`, `confirmNotSent`.
   - `useWallet()` / `usePayPath()`: connectors, account probe, chosen path, funding.
   - `useWalletBalances(addresses)`: live USDC balances of paid wallets (read-only).
   - `useSettings()`, `useRoute()` (hash routes `#/roster`, `#/pay`, `#/history`, `#/runs/<id>`, `#/settings`).
3. **`src/pages/*` + `src/ui/*`**: props-only components. `src/App.tsx` is the only file that calls hooks and
   passes their results to pages.

Don't reimplement logic in components: anything a page would need to compute belongs in a hook or in
`src/lib`, and protocol logic belongs in `@soapay/sdk`.

## WalletConnect

Optional. Set `VITE_WALLETCONNECT_PROJECT_ID` and add `@walletconnect/ethereum-provider` to this package; it is not
a default dependency.
