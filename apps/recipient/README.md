# @soapay/recipient

The employee's app: keys, onboarding, scanner, ledger, privacy-guarded spending, the compliant exit, and
key rotation. (Convert-in-place was removed from the app in D-53; it stays in the SDK and the MCP server.) A static Vite + React SPA. Keys are derived and kept in this browser, encrypted with the
user's passphrase (PBKDF2-SHA256 600k + AES-GCM, `src/vault/crypto.ts`); nothing secret is sent anywhere.

```sh
pnpm --filter @soapay/recipient dev:mock   # in-browser mock API, chain, bundler and ENS
pnpm --filter @soapay/recipient dev        # against VITE_API_URL / VITE_RPC_URL / VITE_BUNDLER_URL
pnpm --filter @soapay/recipient test       # vitest (jsdom)
pnpm --filter @soapay/recipient build
```

Config lives in `.env` (see `.env.example`) and can be overridden per user in Settings. CK's variable
names are accepted as aliases: `VITE_STEALTH_DISPERSE_ADDRESS` (ours, `VITE_STEALTH_DISPERSE`, wins) and
`VITE_RELAY_URL` (its origin becomes the API URL when `VITE_API_URL` is unset). `VITE_OTHER_APP_URL` is the
top bar's "Pay" link to the company app (default: `http://localhost:5174` in dev, `/sender/` in a build).

**Base Sepolia (D-52):** the pay token is Soapay's mock USDC (`VITE_PAY_TOKEN` overrides it), Send's gas is
sponsored through `${apiUrl}/paymaster` (so Send needs the API URL there; mainnet uses the Circle
paymaster), and the **Exit** tab, route and the guard's "Exit through Privacy Pools" offer are hidden,
because CCTP only bridges Circle USDC (`exitOffered(chainId)` in `src/config.ts`).

## Look: CK's Direction A · Ledger

The presentation is CK's design from `@soapay/ui` (imported in `main.tsx`): the `Shell`/`TopBar` frame with
the Payments · Send · Exit (not on the Base Sepolia demo) · Labels · Name · Settings · Pay tabs, his wizard `Steps` for onboarding,
his dashboard layout (headline figure from live balances, ledger table with expandable rows, Rescan / Rescan
from start), and his Settings facts list. `src/ui/kit.tsx` renders the same components as before with Ledger
classes (`btn`, `notice-*`, `pill-*`, `panel`, `facts`, `share`), and `index.css` points Tailwind's colour
names at the Ledger tokens, so Tailwind remains for layout only. IBM Plex is self-hosted by `@soapay/ui`, so
the strict CSP holds; sonner's `Toaster` is not used here because it injects an inline `<style>`.

CK's per-row "reveal private key" is gone. Each ledger row has **Send** (our gasless, guarded spend, which
offers Exit when the guard blocks). Plaintext key export exists only under **Settings → Advanced recovery**,
behind a warning and a confirmation checkbox.

## Keys: a recovery phrase, saved as a recovery kit

Onboarding creates a BIP-39 recovery phrase. The Keys step is **"Save your recovery kit"** (D-44, "save,
don't memorise"): **Download recovery kit** (a `soapay-recovery-kit-<label or date>.txt` made in the browser
with Blob + object URL + `<a download>`; no CSP change, `src/onboarding/recoveryKit.ts`), **Copy phrase**
(for a password-manager note), or **Show words** (for paper). Continue needs one of those plus the "I saved my
recovery kit somewhere safe" box; there is no word quiz. The kit holds only the phrase, the pay name (when an
invite reserved one), the date and restore instructions (Soapay Restore, or `@soapay/sdk` `keysFromMnemonic`
with the BIP-32 paths). The phrase is shown on that screen only: Back from Lock shows "Recovery kit saved".
Restore takes a pasted phrase or **Open recovery kit** (a file input; `parseRecoveryKit` +
`validateMnemonic`).

### Older wallet-signature accounts (restore only)

New accounts can't be made from a wallet signature any more (D-45, supersedes D-23). Accounts made that way
still open, can move to a phrase account (below), and can be recovered from a quiet link on the Restore step,
**Made your account with a wallet signature?**, CK's M1 derivation via SDK `keysFromWalletSignature`
(`src/onboarding/walletKeys.ts`): connect an injected EIP-1193 wallet (no wagmi), read `eth_getCode` on the
wallet's chain and on the payroll chain, and refuse any address with code (smart accounts, passkey wallets,
7702 delegates) **before** asking for a signature. The wallet then signs SDK `SIGN_MESSAGE` twice; the two
signatures must be identical, and must be 65-byte ECDSA by that address, or the SDK refuses.

The vault stores that signature (it is the key material) encrypted with the passphrase, in place of the
phrase: `VaultData.walletKeys = { kind: "wallet-signature", signature, wallet }`, `mnemonic: ""`.
`vaultKeys(data)` derives the keys on unlock. Recovery on another device = Restore → the wallet-signature
link, and sign with the same wallet (the registry entry is already there, so registration is a no-op). Mock
mode offers a demo EOA and a demo smart wallet (refused) instead of a browser wallet.

## What happens where

| Flow | Logic | Spec |
| --- | --- | --- |
| Onboarding | `src/onboarding/machine.ts` (pure reducer), `actions.ts` | PRD Flow 1 |
| Optional World ID recovery session (Proof of Human, D-59) | `src/worldid/` seam, `features/recovery/attach.ts` | mvp-spec §5 |
| Scan | `src/scan/` (worker pool + `runScan` + `mergeScanResult`) | §3 scan.ts |
| Ledger / clusters | `hooks/useWallet.ts` over SDK `buildLedger` / `balanceView` | PRD Flow 3 |
| Send with the guard | `src/spend/flow.ts` (`prepareSpend`, `executeSpend`) | PRD Flow 4 |
| Key rotation | `features/rotation/` (`prepareRotation`, `submitRotation`, `finishRotation`) | §2.1 |
| Pay runs: coworker view / my view (D-41) | `screens/PayRunViews.tsx`, `hooks/useChainViews.ts` over SDK `fetchPayRunBatch` / `markOwnLines` | Goal 2 |
| Gas proof after a spend (D-41) | `screens/GaslessProof.tsx` over SDK `readGaslessProof` | Flow 4 |
| Compliant exit | `features/exit/` (planner, runner, SDK seam `sdk.ts`, mock), `hooks/useExit.tsx` | §9 |

### Key rotation: two paths

- **Attested** (a World ID session is attached to the name and past any cooldown): `<HumanCheck mode="rotate">` proves the
  session, then `POST /names/:label/rotation` carries the RotationClaim, the World ID result and a
  `registerKeysOnBehalf` signature for the new meta. The API attests and relays the ERC-6538 update; the
  app then sends the registrant's `setText(stealth)`. The employer's app auto-accepts.
- **Manual** (no session): the app relays the ERC-6538 update through `/register` and sends the
  `setText`. The employer's app blocks the line until they approve by hand. The UI says so up front.

A half-finished rotation is saved as `profile.pendingRotation` and resumable from Name settings.

**Wallet-signature accounts** rotate by moving to a recovery-phrase account (owner decision 2026-09-26).
Name settings guides them: (1) create a phrase (`useRotation().adoptPhrase` → `adoptRecoveryPhrase`),
(2) optionally Exit or Send funds from the old addresses, (3) the normal rotation above. The wallet keys stay
as generation 0 (still scanned, still spendable, and their registrant still controls the name); generation
g ≥ 1 is the phrase's generation g − 1 (`phraseOffsetOf`, `keysForAccountGeneration`).

## How to plug in another UI

Every screen in `src/screens/` is thin: it renders a hook's state and calls its actions. To build a
different UI (CK's Ledger design now sits on exactly this seam), keep `src/` except `screens/`, `ui/kit.tsx` and `onboarding/Onboarding.tsx`,
and write new components against these:

| Import | Gives you |
| --- | --- |
| `VaultProvider`, `useVault()` (`src/vault/VaultProvider.tsx`) | `status` (`loading`/`empty`/`locked`/`unlocked`), `create(phrase \| walletKeySecret, passphrase)`, `unlock`, `lock`, `update`, `wipe` |
| `ServicesProvider`, `useServices()` | API client, chain reads, spend / exit / ENS services; mock or real by env |
| `ScannerProvider`, `useScanner()` (`src/hooks/scanner.tsx`) | `scan({full?})`, `cancel`, `running`, `phase`, `last`, `error`; `describePhase(phase)` |
| `useWallet()` | `ledger`, `view` (clusters), `balances`, `total`, `spends`, `conversions`, `payerName` |
| `useSpendFlow()` | `state` (`form` → `review` → `sending` → `result`), `prepare(to, amount)`, `setOverride`, `send`, `reset` |
| `useRotation()` | `state` (`idle` → `confirm` → `human`? → `working` → `done`), `path`, `start`, `confirm`, `onHuman`, `resume`, `attach` |
| `ExitProvider`, `useExit()` | `exits` (per-leg state), `sources`, `estimate(selected, privacy)`, `start`, `withdrawNow`, `retry`; polls and resumes on its own while unlocked |
| `useLabels()` | `rows`, `setLabel(address, label)`, `remove` |
| `useSettings()` | `settings`, `save`, `addPayer`, `removePayer`, `exportBackup`, `exportRawKeys` (advanced recovery), `keySource`, `lock`, `wipe` |
| `onboarding/machine.ts`, `onboarding/recoveryKit.ts`, `onboarding/walletKeys.ts` | `reduce`, `resumeState`; `recoveryKitText`, `parseRecoveryKit`, `downloadText`; `deriveWalletKeys` to recover older EOA-signature accounts: drive your own onboarding screens |
| `worldid/index.ts` | `HumanCheck` (one-line swap to `@soapay/worldid-react`), `sessionSignal`, `rotateSignal` |

Mount order: `VaultProvider` → `ServicesProvider` → (once unlocked and `profile.onboardedAt` is set)
`ScannerProvider` → your router. See `src/App.tsx` for the whole gate in ~60 lines. Reusable props-only
pieces: `screens/GuardDecision.tsx` (`GuardDecision`, `canSend`) and `ui/format.ts`.

Rules any UI must keep: never display or log keys except the one-time seed backup and the warned Settings → Advanced recovery export; show amounts from
`ledger[].balance` only (never `claimedAmount`); disable Send when `canSend(plan)` is false unless the user
ticks the override; keep conversion history local.

## Compliant exit (Privacy Pools)

When Send's guard blocks an identifiable destination, the review offers **Exit through Privacy Pools**
(`screens/ExitOffer.tsx`, `features/exit/entry.ts`); the override checkbox stays as the secondary path.
The Exit screen (also in the nav) plans one leg per stealth address, never combined, with worst-case fees
(CCTP forwarding 1.54–2.21, pool entry 1%, relayer 0.1%, paymaster gas) and the 10 USDC pool minimum.

`ExitProvider` polls active legs, calls the SDK one step at a time, and writes each step into the vault
(`chains[id].exits`, `profile.nextExitPoolIndex`), so a reload or lock resumes on unlock. Round
withdrawals and a random delay after approval (2–24 h; seconds in mock) are on by default.

**SDK seam:** `features/exit/sdk.ts`. The real service picks up `planExit` / `advanceExitLeg` /
`derivePoolSecrets` from `@soapay/sdk` as soon as they're exported; until then it reports "hasn't landed".
When `packages/sdk/src/exit.ts` lands: switch `sdkExit()` to a static import, re-export the SDK's types
from `features/exit/types.ts`, and align `buildCtx` with the SDK's context. Mock mode
(`features/exit/mock.ts`) runs the whole flow in ~35 s per leg (approval ~15 s) and declines the leg with
pool index 1 to show the refund path.

## Connect to a dApp (WalletConnect, D-61)

The **dApps** tab (also "dApp" on each ledger row and "Use a dApp instead" on Send) makes the app a
WalletConnect wallet for ONE payment address per session: pick the address, paste the dApp's `wc:` link,
approve. Requests from connected dApps open an approval sheet over any screen (`screens/DappRequestSheet.tsx`)
with the decoded calls, how gas is paid and the privacy guard's verdict.

- Needs `VITE_WALLETCONNECT_PROJECT_ID` (Reown project id, public; allow-list the app's origin in the Reown
  dashboard). Unset, the screen says "WalletConnect isn't configured". The WalletConnect SDK is loaded
  lazily: the relay is only contacted once you connect, or on unlock if you have connected before.
- Supported: `eth_accounts`, `eth_chainId`, `wallet_switchEthereumChain` (active chain only),
  `eth_sendTransaction` (value must be 0; returns the bundle tx hash once the userOp lands),
  `wallet_sendCalls` / `wallet_getCallsStatus` / `wallet_getCapabilities` (atomic + paymasterService),
  `personal_sign`, `eth_signTypedData_v4`. Everything else is refused with 4200.
- Code: `features/walletconnect/` (`router.ts` method → action, `namespaces.ts` one-address sessions,
  `controller.ts` WalletKit wiring), `hooks/useWalletConnect.tsx`, `services/dapp.ts` (SDK
  `executeFromStealth`; mock in `services/mock.ts`). Protocol logic is in `@soapay/sdk` (`dapp.ts`).
- On Base Sepolia a dApp's contracts must be in the API's `PAYMASTER_EXTRA_TARGETS`, or sponsorship is refused.

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
