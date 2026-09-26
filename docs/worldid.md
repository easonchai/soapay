# World ID in Soapay

Soapay uses World ID 4.0 (IDKit 4.3) at **one trust moment: account recovery (key rotation)**, with the **Proof of Human** credential in a World ID session. A name's meta-address decides where future salary goes. When an employee changes it, World ID lets the payer's app accept the change automatically, because the same person who set up the name has confirmed it.

Spec: `docs/mvp-spec.md` §2.1 (rotation, formats) and §5 (World ID). Code: `apps/api/src/worldid/`, `apps/api/src/routes/rotation.ts`, `packages/sdk/src/rotation.ts`, `packages/worldid-react`.

## The trust moment

Under option A, the registrant key controls the ENSv2 `stealth` record, and the sender app pins the meta-address it resolved at enrollment. When the record changes, the sender app has to decide: pay the new meta-address, or block the line until someone checks.

A stolen registrant key (a phished seed, malware) can change the record. On its own, it can't get paid:

- **With World ID:** the change is auto-accepted only with a `MetaRotation` attestation, and the API signs one only after a `proveSession` for the session saved with the name. The thief doesn't have the employee's face.
- **Without it:** the line is blocked until the employer approves the change by hand.

There is **no enrollment gate**. Onboarding doesn't need World ID, and relayer abuse is handled with rate limits. The employee *may* create a World ID session when claiming the name, or attach one later.

## Why Proof of Human is the proportionate credential

The trust moment is **account recovery**: an employee's key leaked or their device is gone, and they move their name to new keys. That decides where **all future salary** goes, so it is the highest-stakes action in the product. The question it asks is *"is this the same person who set up this name?"*

- **A session answers "same person".** The World ID session is created once, when the name is claimed (or attached later), and every rotation must prove that same session. A thief with the old key can rewrite the ENS record, but can't produce the session proof, so the payer's app won't follow the change.
- **Proof of Human is the proportionate strength.** World describes Selfie Check as *"a medium-assurance signal"*. For an action that redirects someone's pay, "probably the same person" isn't enough; Proof of Human is World's strongest human credential. We tried Selfie Check first (the lightest option) and moved up because medium assurance doesn't match what's at stake (D-54).
- **Nothing stronger is needed.** Passport or identity attributes would collect real-world identity the product doesn't need: the employer already knows its employees, and a DAO's contributors may deliberately stay pseudonymous. Proof of Human proves a unique, same human without revealing who they are.
- **It's also the smoother flow.** No selfie capture at the moment of recovery; the World App confirms in a tap. The trade-off: the employee needs a World ID with Proof of Human. Without one, recovery still works, but the employer approves the key change by hand (the fallback below).

## Where it's essential: pseudonymous contributors

For a known employee, HR can phone them and confirm a change, so World ID saves a manual step. For a **DAO contributor known only by a handle**, the payer has no out-of-band channel. There's no phone number and no face on file. A World ID session is then the *only* continuity signal available, and it keeps the contributor pseudonymous: the DAO learns "the same person as before", never who they are.

## Fallback

Every refusal ends the same way: no attestation, so the sender app blocks the line and shows "meta change unverified". The employer (or DAO payer) then approves or rejects by hand. This covers:

- a name with no session (`no_session`);
- a cancelled or failed World App flow (`proof_cancelled`), or no proof at all (`proof_missing`);
- an expired RP context or deadline (`request_expired`, `expired`);
- a different person (`session_mismatch`);
- a replayed proof (`session_replayed`, `request_used`);
- a proof from another environment (`environment_mismatch`), the wrong credential (`wrong_credential`), or one the Developer Portal rejects (`proof_invalid`);
- World ID being unreachable (`worldid_unavailable`) or disabled (`WORLD_ID_DISABLED=true`).

Nothing in Soapay depends on World ID being available. It only decides whether a change needs a human in the loop.

### Threat demo

`scripts/demo-attacker.ts` (D-55) plays the thief with a stolen recovery phrase. It derives the victim's registrant key, rewrites the victim's `stealth` record on its own PermissionedResolver (and the ERC-6538 entry on Base, so the name still resolves cleanly), then asks `POST /names/:label/rotation` for an attestation with a valid `RotationClaim` signature but no World ID proof. The API refuses (`409 no_session` for a name without a session; `403 proof_missing` for one with a session), so the sender app's pin check blocks the line. `scripts/demo-recovery-check.ts` asserts the whole path live: pin → attack → **blocked, attestation `missing`** (SDK `checkMetaPin`) and `soapay distribute` exit 3 → restore. Run on 2026-09-26: docs/testnet-deployment.md, "Recovery beat". Stage steps: docs/demo-flow.md, "Recovery beat".

What it shows, and what it doesn't: World ID protects **future** salary, because the payer follows a record change only with the same human's proof. A stolen phrase still controls funds already received; the recovery kit's safety (keep the phrase offline, move funds and rotate on any suspicion) covers that.

## Sequences

### Enrollment, with an optional session

```mermaid
sequenceDiagram
  participant R as Recipient app
  participant W as World App
  participant A as Soapay API
  participant P as Developer Portal
  R->>A: POST /worldid/rp-context
  A-->>R: rp_context (signRequest, no action), app_id, environment
  R->>W: IDKitSessionWidget, constraints = selfie, signal = sessionSignal(label, registrant)
  W-->>R: session result (session_id, session_nullifier, proof)
  R->>A: POST /names {claim, worldIdSession}
  A->>A: NameClaim sig, nonce, signal, credential, environment
  A->>P: POST /api/v4/verify/{rp_id}
  P-->>A: success
  A->>A: issue subname, store name + session_id (one transaction)
  A-->>R: 201 {worldIdSession: {attachedAt}}
```

If the user cancels, the app claims the name without `worldIdSession` and can attach one later with `POST /names/:label/session` (signed `AttachSession`). A session attached later can back a rotation only after `WORLD_ATTACH_COOLDOWN_SECONDS` (72 h by default), so someone holding a stolen key can't attach their own session and rotate immediately. A name never replaces its session through the API.

### Rotation, accepted

```mermaid
sequenceDiagram
  participant R as Recipient app
  participant W as World App
  participant A as Soapay API
  participant P as Developer Portal
  participant B as ERC-6538 (Base)
  participant E as ENSv2 resolver (Sepolia)
  participant S as Sender app
  R->>A: POST /worldid/rp-context
  A-->>R: rp_context
  R->>W: IDKitSessionWidget existing_session_id = saved, signal = rotationSignal(label, newMeta, deadline)
  W-->>R: session proof
  R->>A: POST /names/:label/rotation {newMeta, deadline, registrantSig, registerSig, worldIdResult}
  A->>A: RotationClaim sig, session_id == saved, nullifier + nonce unused
  A->>P: verify
  P-->>A: success
  A->>B: simulate registerKeysOnBehalf(newMeta)
  A->>A: sign MetaRotation, store, mark proof used
  A->>B: send registerKeysOnBehalf (relayer)
  A->>E: top up the registrant's gas (L1 relayer)
  A-->>R: 201 {attestation, registry, topup}
  R->>E: setText("stealth", newMeta) from the registrant key
  S->>E: re-resolve before the next run: pin changed
  S->>A: GET /names/:label/attestations
  S->>S: verifyTypedData(signer == VITE_ATTESTER, newMeta matches) → auto-accept, "re-verified by World ID"
```

### Rotation, denied

```mermaid
sequenceDiagram
  participant X as Registrant key (maybe stolen)
  participant A as Soapay API
  participant E as ENSv2 resolver
  participant S as Sender app
  participant H as Employer
  X->>A: POST /names/:label/rotation (no / cancelled / other person's / replayed proof)
  A-->>X: 409 no_session | 403 proof_cancelled | 403 session_mismatch | 403 session_replayed
  Note over A: no attestation is signed
  X->>E: setText("stealth", attackerMeta) (the key can still do this)
  S->>E: re-resolve: pin changed
  S->>A: GET /names/:label/attestations → nothing for attackerMeta
  S->>H: line blocked: "meta change unverified"
  H->>S: approve by hand, or reject
```

## Developer Portal setup

- App: `app_0cc7167efe114ac2e0ef7d9827098353` ("Soapay"), World ID 4.0.
- RP: `rp_3ede5fe1cab9af48`, registered on-chain for staging and production. The signer address is `0xCaf38A54bA7B0C15Eb253cb513f0B0A93AAA349D`; its private key lives only in the operator's `apps/api/.env` as `WORLD_RP_SIGNING_KEY` and is never committed.
- Action `soapay-enroll` exists in staging and production but is **unused**: sessions take no action, and the enrollment gate it was made for was dropped.
- `WORLD_ENV=production` on the live demo since 2026-09-26 (D-51): the real World App. `staging` uses the simulator. Selfie Check testing in the World docs runs in the **sandbox** environment (`WORLD_ENV=sandbox`), so use that if the staging simulator doesn't offer the Selfie Check credential.
- Server: `apps/api/.env` from `apps/api/.env.example`, then `WORLD_RP_SIGNING_KEY` and `ATTESTER_PRIVATE_KEY`. `GET /worldid/config` shows what the API runs with.

## What we store

Per name: its `session_id`, when it was attached, and how (`enroll` or `attach`). Globally: every used `session_nullifier` and every RP nonce we signed (pruned a day after expiry). Per rotation: the attestation. We never store or see identity, and the session id is never served by public routes.

## Integration debrief

**Time to first success:** *(fill in after the first live World App run)*.

**The one improvement with the greatest impact:** let `IDKitSessionWidget` accept `preset={selfieCheck()}` (today it only takes `constraints`, and a hand-built Selfie Check constraint fails in the production World App with `generic_error`), and return a specific error code instead of `generic_error` so the cause is visible. That single fix would have saved us the most time.

What went well:

- The Developer Portal verify endpoint takes the IDKit result unchanged, which kept the server small: local checks first (nonce, session id, signal hash, credential, environment, replay), then one Portal call.
- `signRequest` from `@worldcoin/idkit-server` made the RP context a five-line route, and the single-use nonce doubled as our replay guard.
- The `session_id` / `session_nullifier` split maps directly onto "bind to the account" and "reject replays".

Friction, honestly:

- **Sessions take `constraints`, not `preset`.** The session-proofs page shows `IDKitSessionWidget` with `preset={selfieCheck()}`, but in IDKit 4.3 `IDKitSessionWidgetProps` only accepts `constraints` (the request widget accepts either). We use `CredentialRequest("selfie", { signal })`. This cost a round of type errors, and the docs should say so. **Update 2026-09-26:** on the first run with a real World App (production), the widget's hand-built `CredentialRequest("selfie")` constraint made World App answer `generic_error`. We switched to IDKit core's `createSession` / `proveSession(...).preset(selfieCheck({ signal }))`, as the session docs show, and render the QR code and poll ourselves (`packages/worldid-react`).
- **The design changed under us.** We first built a two-moment design with Proof of Human (uniqueness at enrollment plus rotation). Re-reading the session docs made it clear that rotation is a continuity question, so the enrollment gate and the uniqueness action went, and Selfie Check sessions replaced Proof of Human. The code got simpler.
- **Environments.** Proof results, the Portal response and the IDKit config each carry an environment, and the Portal defaults it to production. We refuse a mismatch at both checkpoints. It's easy to get this wrong silently.
- **What we did not do:** our tests mock the Developer Portal (`apps/api/test/worldid.test.ts`). We haven't yet run a Selfie Check session end to end against the simulator or a real World App, so the exact shape of a live Selfie Check session result (for example whether `signal_hash` is always present) is checked only against the IDKit 4.3 type definitions. That's the first thing to do before a demo.
