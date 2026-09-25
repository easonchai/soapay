# @soapay/worldid-react

`<HumanCheck>` is the World ID step of Soapay's key rotation. It wraps IDKit 4.3's `IDKitSessionWidget` with the **Selfie Check** credential and fetches a fresh RP signature from the Soapay API for every request. Why a Selfie Check session is the right assurance, and the full flow, are in [`docs/worldid.md`](../../docs/worldid.md).

```tsx
import { HumanCheck } from "@soapay/worldid-react";
import { rotationSignal, sessionSignal } from "@soapay/sdk";

// Enrollment (optional): create a session and send it with POST /names as `worldIdSession`,
// or later with POST /names/:label/session (plus an AttachSession signature).
<HumanCheck
  mode="create-session"
  apiUrl={API_URL}
  signal={sessionSignal(label, registrant)}
  onResult={(worldIdSession) => claimName({ ...claim, worldIdSession })}
  onCancel={() => setNote("You can add World ID later from Settings.")}
  onError={(e) => setError(e.message)}
/>

// Rotation: prove the saved session; send the result as `worldIdResult`
// to POST /names/:label/rotation.
<HumanCheck
  mode="rotate"
  apiUrl={API_URL}
  sessionId={savedSessionId}
  signal={rotationSignal(label, newMeta, deadline)}
  onResult={(worldIdResult) => rotate({ newMeta, deadline, registrantSig, registerSig, worldIdResult })}
  onCancel={() => setNote("Not verified: your employer will have to approve the change by hand.")}
  onError={(e) => setError(e.message)}
/>
```

## Props

| Prop | |
| --- | --- |
| `mode` | `"create-session"` or `"rotate"` |
| `apiUrl` | Soapay API base URL. The component calls `POST {apiUrl}/worldid/rp-context` each time it opens. |
| `sessionId` | The `session_<hex>` id saved at enrollment. Required for `rotate`. |
| `signal` | Must match what the API recomputes: `sessionSignal(label, registrant)` or `rotationSignal(label, newMeta, deadline)` from `@soapay/sdk`. A different signal is refused (`signal_mismatch`). |
| `onResult` | Gets the IDKit session result. Forward it **unchanged**: the API verifies it with the Developer Portal. |
| `onCancel` | The user declined or closed World App. |
| `onError` | `HumanCheckError` with a `code`: an API error code (e.g. `worldid_disabled`, `rate_limited`), `no_session`, or an IDKit error code. |
| `open`, `onOpenChange` | Optional controlled mode. Without `open`, the component renders its own button (`children` is its label). |
| `actionDescription` | Optional text shown in World App. |
| `fetch` | Optional fetch override. |

`selfieCheckConstraint(signal)` and `fetchRpContext(apiUrl)` are exported for apps that drive IDKit themselves (for example with `useIDKitSession`).

## Notes

- The session proof is only a claim until the API verifies it. Never treat `onResult` as success on its own; the API's answer is what counts.
- IDKit 4.3's session widget takes `constraints`, not `preset`. The session-proof docs show `preset={selfieCheck()}`, which doesn't typecheck against `IDKitSessionWidgetProps`, so this package uses `CredentialRequest("selfie", { signal })`.
- The environment (`staging`, `production` or `sandbox`) comes from the API (`WORLD_ENV`), so the client and the server can't disagree.
- Build: `pnpm --filter @soapay/worldid-react build`. React 18 or 19 is a peer dependency.
