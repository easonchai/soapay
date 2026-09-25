# @soapay/recipient

The employee's app: keys, onboarding, scanner, ledger, privacy-guarded spending, convert-in-place, and
key rotation. A static Vite + React SPA. Keys are derived and kept in this browser, encrypted with the
user's passphrase (PBKDF2-SHA256 600k + AES-GCM, `src/vault/crypto.ts`); nothing secret is sent anywhere.

```sh
pnpm --filter @soapay/recipient dev:mock   # in-browser mock API, chain, bundler, ENS and Uniswap
pnpm --filter @soapay/recipient dev        # against VITE_API_URL / VITE_RPC_URL / VITE_BUNDLER_URL
pnpm --filter @soapay/recipient test       # vitest (jsdom)
pnpm --filter @soapay/recipient build
```

Config lives in `.env` (see `.env.example`) and can be overridden per user in Settings.

## What happens where

| Flow | Logic | Spec |
| --- | --- | --- |
| Onboarding | `src/onboarding/machine.ts` (pure reducer), `actions.ts` | PRD Flow 1 |
| Optional World ID recovery session | `src/worldid/` seam, `features/recovery/attach.ts` | mvp-spec §5 |
| Scan | `src/scan/` (worker pool + `runScan` + `mergeScanResult`) | §3 scan.ts |
| Ledger / clusters | `hooks/useWallet.ts` over SDK `buildLedger` / `balanceView` | PRD Flow 3 |
| Send with the guard | `src/spend/flow.ts` (`prepareSpend`, `executeSpend`) | PRD Flow 4 |
| Convert in place | `features/convert/swap.ts` over SDK `quoteSwapInPlace` / `swapInPlace` | §6 |
| Key rotation | `features/rotation/` (`prepareRotation`, `submitRotation`, `finishRotation`) | §2.1 |

### Convert and the Uniswap API key

Quotes go to the Soapay API's proxy at `${apiUrl}/uniswap`, which adds `UNISWAP_API_KEY` server-side.
The key never ships in this bundle. Turn the proxy off in Settings (or `VITE_SWAP_VIA_API=0`) and the SDK
prices directly against the Universal Router V3 with QuoterV2 instead.

### Key rotation: two paths

- **Attested** (a World ID session is attached to the name and past any cooldown): `<HumanCheck mode="rotate">` proves the
  session, then `POST /names/:label/rotation` carries the RotationClaim, the World ID result and a
  `registerKeysOnBehalf` signature for the new meta. The API attests and relays the ERC-6538 update; the
  app then sends the registrant's `setText(stealth)`. The employer's app auto-accepts.
- **Manual** (no session): the app relays the ERC-6538 update through `/register` and sends the
  `setText`. The employer's app blocks the line until they approve by hand. The UI says so up front.

A half-finished rotation is saved as `profile.pendingRotation` and resumable from Name settings.

## How to plug in another UI

Every screen in `src/screens/` is thin: it renders a hook's state and calls its actions. To build a
different UI (for example CK's design), keep `src/` except `screens/` and `onboarding/Onboarding.tsx`,
and write new components against these:

| Import | Gives you |
| --- | --- |
| `VaultProvider`, `useVault()` (`src/vault/VaultProvider.tsx`) | `status` (`loading`/`empty`/`locked`/`unlocked`), `create`, `unlock`, `lock`, `update`, `wipe` |
| `ServicesProvider`, `useServices()` | API client, chain reads, spend / swap / ENS services; mock or real by env |
| `ScannerProvider`, `useScanner()` (`src/hooks/scanner.tsx`) | `scan({full?})`, `cancel`, `running`, `phase`, `last`, `error`; `describePhase(phase)` |
| `useWallet()` | `ledger`, `view` (clusters), `balances`, `total`, `spends`, `conversions`, `payerName` |
| `useSpendFlow()` | `state` (`form` → `review` → `sending` → `result`), `prepare(to, amount)`, `setOverride`, `send`, `reset` |
| `useConvert()` | `state` (`form` → `review` → `swapping` → `done`), `sources`, `targets`, `quote(form)`, `confirm` |
| `useRotation()` | `state` (`idle` → `confirm` → `human`? → `working` → `done`), `path`, `start`, `confirm`, `onHuman`, `resume`, `attach` |
| `useLabels()` | `rows`, `setLabel(address, label)`, `remove` |
| `useSettings()` | `settings`, `save`, `addPayer`, `removePayer`, `exportBackup`, `lock`, `wipe` |
| `onboarding/machine.ts` | `reduce`, `resumeState`, `pickChallenge`: drive your own onboarding screens |
| `worldid/index.ts` | `HumanCheck` (one-line swap to `@soapay/worldid-react`), `sessionSignal`, `rotateSignal` |

Mount order: `VaultProvider` → `ServicesProvider` → (once unlocked and `profile.onboardedAt` is set)
`ScannerProvider` → your router. See `src/App.tsx` for the whole gate in ~60 lines. Reusable props-only
pieces: `screens/GuardDecision.tsx` (`GuardDecision`, `canSend`) and `ui/format.ts`.

Rules any UI must keep: never display or log keys except the one-time seed backup; show amounts from
`ledger[].balance` only (never `claimedAmount`); disable Send when `canSend(plan)` is false unless the user
ticks the override; keep conversion history local.

## Invite links

`#/join?code=<0x…>&label=<label>&org=<org>` (docs/mvp-spec.md §7). `InviteProvider` reads the link once,
looks up `GET /invites/keccak256(code)` (`onboarding/invite.ts`), and keeps the result for the whole
session, so it survives onboarding steps and an unlock:

- **pending**: onboarding shows "Invited by <org>", the label is prefilled and locked, and POST /names
  carries `inviteCode`. Once the claim succeeds, the invite's `employer` address is added to Settings →
  Known payers under the org name (`withInvitePayer`), so that employer's payroll isn't flagged "Unknown payer".
  Known payers can be added or removed by hand in Settings.
- **expired / claimed / unknown**: a clear message, then normal onboarding with the employee's own label.
- **existing vault**: unlock first; an onboarded account without a name then goes straight to the claim.

Mock mode serves two demo invites (`MOCK_INVITES` in `services/mock.ts`): `#/join?code=0x1111…` (64 ones,
pending, label `jordan`) and `#/join?code=0x2222…` (expired).

## Integrations

- **World ID**: `src/worldid/index.ts` picks `@soapay/worldid-react`'s `<HumanCheck>` (IDKit session
  widget, Selfie Check), or `MockHumanCheck` in mock mode. Onboarding creates the session after the label
  is chosen (the signal is `sessionSignal(label, registrant)`) and sends it with POST /names as
  `worldIdSession`. Name settings can attach one later (POST /names/:label/session, SDK AttachSession);
  the API then makes it wait 72 h before it can back a rotation, and the UI shows until when.
- **Rotation**: SDK `rotationClaimTypedData` / `rotationSignal`; setText via the SDK's ENSv2
  `buildSetStealthRecordCall`, sent by the registrant on Sepolia (the API tops up its gas).
- **Swap**: SDK `quoteSwapInPlace` / `swapInPlace` with `apiUrl = ${apiUrl}/uniswap`; on 503
  `uniswap_disabled` the SDK falls back to the Universal Router itself.
- Still app-side: `features/rotation/keys.ts` derives key generations with a BIP-39 passphrase; move it into
  the SDK as an account index (TODO(sdk)).

## Mock mode

`VITE_MOCK_API=1` mocks the API (incl. names, sessions, rotation attestations), Base reads, the bundler,
the ENS writer, World ID and Uniswap. It fabricates three pay runs for the unlocked meta-address with the real SDK
(`derivePayRun`) among ~3,000 unrelated announcements, plus one spam announcement with a fake payer and
amount, so the real scanner, ledger and guard run unchanged. Sending to an address that starts with
`0xfa11` makes the second transaction of the run fail, to show the partial-failure path.
