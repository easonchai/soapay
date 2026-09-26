# @soapay/worldid-react

`<HumanCheck>` is the World ID step of Soapay's account recovery (key rotation). It builds a World ID **session** request with IDKit core 4.3, `IDKit.createSession({app_id, rp_context, environment})` or `IDKit.proveSession(sessionId, {...})`, both `.constraints(CredentialRequest("proof_of_human", {}))`, and renders the QR code inline in the app's own panel (with "On this phone? Open the World ID app", a status line and Cancel; no IDKit pop-up). It fetches a fresh RP signature from the Soapay API for every request. The API stores the session id for the name and later accepts a rotation only for the same session (D-59). Why, and the full flow, are in [`docs/worldid.md`](../../docs/worldid.md).

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
| `onError` | `HumanCheckError` with a `code`: an API error code (e.g. `worldid_disabled`, `rate_limited`), `no_session`, or an IDKit error code. On a World App error, a panel with IDKit's debug report and "Copy details" is shown first; the error is reported when it's closed. |
| `open`, `onOpenChange` | Optional controlled mode. Without `open`, the component renders its own button (`children` is its label). |
| `actionDescription` | Optional text shown in World App. |
| `fetch` | Optional fetch override. |

`humanCheckConstraint()` and `fetchRpContext(apiUrl, fetch, bind)` are exported for apps that drive IDKit themselves.

## Notes

- The session proof is only a claim until the API verifies it. Never treat `onResult` as success on its own; the API's answer is what counts.
- IDKit 4.3 rejects presets for session requests ("Use .constraints() instead"), although World's session docs show `.preset(...)`, so this package uses `CredentialRequest("proof_of_human", {})`.
- No signal goes to World App (D-57): session requests carrying one stalled. The API stores the signal with the single-use RP nonce (`bind`) and checks it on verification.
- The RP must support sessions. The first Soapay RP silently didn't (World App `verification_rejected`, simulator `bad_request`); a freshly created RP did (docs/worldid.md).
- The environment (`staging`, `production` or `sandbox`) comes from the API (`WORLD_ENV`), so the client and the server can't disagree.
- Build: `pnpm --filter @soapay/worldid-react build`. React 18 or 19 is a peer dependency.
