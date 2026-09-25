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

Chosen per connected wallet by `src/lib/paypath.ts`:

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

## How to plug in another UI

The app is three layers. Only the last one is visual, and it is deliberately plain.

1. **`src/lib/*`**: framework-free logic (roster pins, run planning and records, execution state machine,
   Safe export, vault, CSV, amounts, wallet adapters over `wagmi/actions`). Unit-tested in `test/`.
2. **`src/hooks/*`**: React hooks that own all state and side effects. They render nothing.
   - `StoreProvider` / `useStore()` (`store.tsx`): vault phase, roster, run history, `executeRun`.
   - `useRoster()`: enroll, CSV import, re-verify, re-approve, pause, amount edit, mock rotation.
   - `usePayRun()`: `verify()` → `preview(denomination)` → `execute()` or `exportSafe(safe)`.
   - `useRunActions(id)` / `useHistory()`: status, names → amounts report, `recheck`, `retry`, `confirmNotSent`.
   - `useWallet()` / `usePayPath()`: connectors, account probe, chosen path, funding.
   - `useSettings()`, `useRoute()` (hash routes `#/roster`, `#/pay`, `#/history`, `#/runs/<id>`, `#/settings`).
3. **`src/pages/*` + `src/ui/kit.tsx`**: props-only components. `src/App.tsx` is the only file that calls
   hooks and passes their results to pages.

To use a different design: keep `main.tsx` (providers) and replace `App.tsx`, `pages/` and `ui/` with your own
components that call the same hooks. Each page's props type is exactly its hook's return type (plus a few
callbacks), so an alternative page can be dropped in one at a time. Don't reimplement logic in components:
anything a page would need to compute belongs in a hook or in `src/lib`, and protocol logic belongs in
`@soapay/sdk`.

## WalletConnect

Optional. Set `VITE_WALLETCONNECT_PROJECT_ID` and add `@walletconnect/ethereum-provider` to this package; it is not
a default dependency.
