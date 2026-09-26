# @soapay/worldid-react

`<HumanCheck>` is the World ID step of Soapay's account recovery (key rotation). It wraps IDKit 4.3's `IDKitRequestWidget` with a one-time **Proof of Human** request on the action `soapay-recovery` (`preset={proofOfHuman({ signal })}`, `allow_legacy_proofs={false}`) and fetches a fresh RP signature from the Soapay API for every request. The API links the proof's nullifier to the name, and later accepts a rotation only with the same nullifier (D-58). Why, and the full flow, are in [`docs/worldid.md`](../../docs/worldid.md).

```tsx
import { HumanCheck } from "@soapay/worldid-react";
import { rotationSignal, sessionSignal } from "@soapay/sdk";

// Enrollment (optional): link World ID. Send the result with POST /names as `worldIdSession`,
// or later with POST /names/:label/session (plus an AttachWorldId signature over its nullifier).
<HumanCheck
  mode="create-session"
  apiUrl={API_URL}
  signal={sessionSignal(label, registrant)}
  onResult={(worldIdSession) => claimName({ ...claim, worldIdSession })}
  onCancel={() => setNote("You can add World ID later from Settings.")}
  onError={(e) => setError(e.message)}
/>

// Rotation: prove it's the same human; send the result as `worldIdResult`
// to POST /names/:label/rotation.
<HumanCheck
  mode="rotate"
  apiUrl={API_URL}
  signal={rotationSignal(label, newMeta, deadline)}
  onResult={(worldIdResult) => rotate({ newMeta, deadline, registrantSig, registerSig, worldIdResult })}
  onCancel={() => setNote("Not verified: your employer will have to approve the change by hand.")}
  onError={(e) => setError(e.message)}
/>
```

## Props

| Prop | |
| --- | --- |
| `mode` | `"create-session"` (link World ID; the name is historical) or `"rotate"` (prove it's still you). Both run the same request; the API decides what the proof is for. |
| `apiUrl` | Soapay API base URL. The component calls `POST {apiUrl}/worldid/rp-context` each time it opens; the response carries `action` and `environment`. |
| `sessionId` | Deprecated and ignored since D-58. |
| `signal` | Must match what the API recomputes: `sessionSignal(label, registrant)` or `rotationSignal(label, newMeta, deadline)` from `@soapay/sdk`. A different signal is refused (`signal_mismatch`). |
| `onResult` | Gets the IDKit result. Forward it **unchanged**: the API verifies it with the Developer Portal. |
| `onCancel` | The user declined or closed World App. |
| `onError` | `HumanCheckError` with a `code`: an API error code (e.g. `worldid_disabled`, `rate_limited`) or an IDKit error code. On a World App error, a panel with the debug report and "Copy details" is shown first. |
| `open`, `onOpenChange` | Optional controlled mode. Without `open`, the component renders its own button (`children` is its label). |
| `actionDescription` | Optional text shown in World App. |
| `fetch` | Optional fetch override. |

`humanCheckPreset(signal)` and `fetchRpContext(apiUrl)` are exported for apps that drive IDKit themselves (for example with `useIDKitRequest`).

## Notes

- The proof is only a claim until the API verifies it. Never treat `onResult` as success on its own; the API's answer is what counts.
- World ID sessions (`IDKitSessionWidget`) were used before D-58 and are gone: session requests fail for Soapay's RP (docs/worldid.md).
- The environment (`staging`, `production` or `sandbox`) and the action come from the API (`WORLD_ENV`, `WORLD_ACTION`), so the client and the server can't disagree.
- Build: `pnpm --filter @soapay/worldid-react build`. React 18 or 19 is a peer dependency.
