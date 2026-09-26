# ETHGlobal Tokyo 2026: sponsor prize answers

Paste-ready text for the "How are you using this Protocol / API?" section of the submission form. Each sponsor asks the same four things: why we qualify, a link to the line of code, an ease-of-use score from 1 to 10, and feedback for the sponsor. Every code link below is a permalink to main at commit `82c0958`, so the line numbers will not drift. Prize text is quoted from the ETHGlobal Tokyo 2026 prize page, fetched 2026-09-26.

Which prize we are going for, per sponsor:

| Sponsor | Prize we fit | Amount | Why that one |
| --- | --- | --- | --- |
| World | Best Use of IDKit | $5,000, up to 2 teams | Their strong examples include "recovery or protection of an important account action", which is exactly our one trust moment. We do not use World ID for Agents, so do not claim that track. |
| ENS | Best Use of ENSv2 | $6,000, 1st to 3rd | ENSv2 on Sepolia is central: every payee is a subname with its own Permissioned Resolver and per-record roles. |
| Curvegrid | Best AI Agent Project | $1,000 | "Using our blockchain development platform MultiBaas is not a requirement." Our MCP server is a policy-aware stablecoin payment agent, which is three of their listed ideas. We do not use MultiBaas, and we say so. |

## World ($15,000): Best Use of IDKit

**Why you're applicable**

```text
Applying for Best Use of IDKit. Soapay uses IDKit for one trust moment: recovering a pay name. An employee's ENS name decides where all future salary goes, so when they replace a leaked key, the payer's app follows the new address only with a Proof of Human session proof from the same human, verified server-side (nonce, session id, signal, credential, environment, replay, then the Developer Portal v4 verify endpoint) before our API signs the EIP-712 attestation the payer requires. Every other path (no session, a cancelled proof, a different person, a replayed or wrong-environment proof, World ID unreachable) ends with the line blocked for manual employer approval. Proof of Human is the proportionate credential: the question is continuity, so a session answers it; moving someone's pay is the highest-stakes action in the product, and World calls Selfie Check medium-assurance; passport-level identity would collect data we do not need. There is no World ID gate on onboarding and we never store identity, only session ids and used session nullifiers.
```

Strict two-sentence version, if the field enforces its limit:

```text
Soapay uses IDKit for one trust moment: recovering a pay name, where an employee's ENS name decides where all future salary goes, so the payer's app follows a key change only with a Proof of Human session proof from the same human, verified server-side against the Developer Portal before our API signs the attestation the payer requires. Every other path (no session, a cancelled proof, a different person, a replayed or wrong-environment proof) leaves the line blocked for manual employer approval, with no onboarding gate and no identity stored.
```

**Link to the line of code**

Primary, the session proof checks and the Proof of Human requirement:

```text
https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/api/src/worldid/verifier.ts#L118-L140
```

If the field takes more than one link, or in the feedback field:

- Developer Portal verify call: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/api/src/worldid/portal.ts#L26
- IDKit core `createSession` / `proveSession` in the employee app: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/packages/worldid-react/src/index.tsx#L145
- The attestation signed only after a verified proof: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/api/src/routes/rotation.ts#L200
- The payer's app accepting a changed pin only with that attestation: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/sender/src/lib/attestation.ts#L96
- Refusal paths under test: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/api/test/worldid.test.ts#L269
- Design, sequences for the accepted and denied paths, and the debrief: https://github.com/easonchai/soapay/blob/main/docs/worldid.md

**How easy is it to use (1 to 10)**

Suggested: **6**. The server side was easy (the Portal takes the IDKit result unchanged, `signRequest` made the RP context five lines). The client side cost the most time: the session widget's props do not match the session-proofs docs, a failure surfaces only as `generic_error`, the environment defaults silently, and Selfie Check sessions kept failing in the World App. Move it to 7 if the live Proof of Human run goes through first time.

**Additional feedback for the sponsor**

```text
Time to first success: [fill in after the live World App run; docs/worldid.md holds the placeholder].

What went well: the Developer Portal v4 verify endpoint takes the IDKit result unchanged, so our server is local checks plus one call. signRequest from @worldcoin/idkit-server made the RP context a five-line route, and its single-use nonce doubled as our replay guard. The session_id / session_nullifier split maps directly onto "bind to the account" and "reject replays".

Friction: (1) The session-proofs page shows IDKitSessionWidget with preset={selfieCheck()}, but in IDKit 4.3 the session widget only accepts constraints (the request widget accepts either). That cost a round of type errors. (2) A hand-built Selfie Check constraint made the production World App answer generic_error with no cause, so we switched to IDKit core's createSession / proveSession and render the QR code and polling ourselves to get at the debug report. (3) Selfie Check sessions kept failing in the World App while Proof of Human verified; together with Selfie Check being medium-assurance, that is why we ended on Proof of Human for recovery. (4) Proof results, the Portal response and the IDKit config each carry an environment, and the Portal defaults to production, so a mismatch is easy to get wrong silently. We refuse it at both checkpoints.

Missing: a specific error code instead of generic_error, and a documented environment for testing sessions with each credential (sandbox versus the staging simulator).

The one improvement with the greatest impact: let IDKitSessionWidget accept preset, or make the docs match the types, and return specific error codes instead of generic_error. That single fix would have saved us the most time.
```

## ENS ($10,000): Best Use of ENSv2

**Why you're applicable**

```text
Applying for Best Use of ENSv2. Every payee in Soapay is an ENSv2 name on Sepolia: soapay.eth runs its own subname registry, and each employee or agent gets a subname with its own PermissionedResolver, deployed through the VerifiableFactory with its stealth text record and its roles set atomically in initialize. Enhanced Access Control gives each actor exactly one power: the employee's key holds ROLE_SET_TEXT on the stealth record only, our issuer holds ROLE_REGISTRAR only, the subname carries an empty role bitmap so it cannot be transferred, and the company keeps ROLE_UNREGISTER. The name is how every payment is addressed (the payer resolves it once through the Universal Resolver, pins the meta-address, and derives a fresh stealth address per payment), and the per-record roles are what make "only the employee can redirect their own salary" enforceable on chain. There is no addr record on purpose, so a plain wallet cannot pay a static, linkable address. AI agents get the same names with ENSIP-26 agent-context and agent-endpoint records, written in the same initialize call. Live on Sepolia, issued from the running app, with a Foundry fork test against the real ENSv2 contracts.
```

Strict two-sentence version, if the field enforces its limit:

```text
Every payee in Soapay is an ENSv2 subname on Sepolia with its own PermissionedResolver, deployed through the VerifiableFactory with its stealth record and roles set atomically in initialize, and Enhanced Access Control gives each actor one power: the employee's key can write only the stealth record, our issuer can only register names, subnames are non-transferable, and the company can only revoke. The name is how every payment is addressed (resolved once through the Universal Resolver, pinned, then a fresh stealth address per payment), so ENSv2's per-record roles are what make "only the employee can redirect their own salary" enforceable on chain, with no addr record on purpose and ENSIP-26 records for agents.
```

**Link to the line of code**

Primary, the issuer that deploys a resolver per name and registers the subname:

```text
https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/packages/sdk/src/ensv2.ts#L659-L750
```

If the field takes more than one link, or in the feedback field:

- Records and roles set inside `initialize`: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/packages/sdk/src/ensv2.ts#L387-L434
- The EAC role model: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/packages/sdk/src/ensv2.ts#L77-L122
- Resolution through viem's Universal Resolver path, cross-checked against ERC-6538: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/packages/sdk/src/names.ts#L72-L107
- ENSIP-26 agent records: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/packages/sdk/src/ensv2.ts#L752-L884 and https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/mcp/src/tools/identity.ts#L109-L190
- Fork test against the live ENSv2 contracts: https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/contracts/test/ENSv2Names.fork.t.sol#L79-L174
- Live: `soapay.eth` subname registry `0x7403C470a91B21AB77B4E246a39c1Adfcc317969`; an issuance from the running app: https://sepolia.etherscan.io/tx/0x4b11d38050ef0020f5de0e4a269ed278f206ee0f0d5b61f84aa4e9b56db2e255
- Design doc: https://github.com/easonchai/soapay/blob/main/contracts/ENSV2.md

**How easy is it to use (1 to 10)**

Suggested: **8**. Resolution needed no custom code, the factory plus `initialize` pattern gave us atomic records, and the role bitmaps were clear once read. Two things cost real time: a silent revert on `register` for 7702-delegated owners, and text roles being scoped per key across a whole resolver.

**Additional feedback for the sponsor**

```text
What went well: viem's default Sepolia Universal Resolver already routes to UniversalResolverV2, so resolving ENSv2 names took no custom client code. Setting records and roles inside PermissionedResolver.initialize through the VerifiableFactory lets a name land with its records atomically, before it is registered. The Enhanced Access Control bitmaps were clear once we read them, and ENSIP-26 keys were easy to add at issuance.

Friction: (1) PermissionedRegistry.register safe-mints an ERC-1155, so an owner that is an EIP-7702-delegated EOA without onERC1155Received reverts with no reason. Sepolia's public anvil keys are delegated, which cost us hours before we found it. A revert reason, or a note in the docs, would fix it. (2) Text-record roles are scoped per key across the whole resolver, not per name, so a name-per-employee model needs one resolver per name, two issuer transactions each. Worth stating up front in the Permissioned Resolver docs. (3) grantSetterRoles checks the caller's admin role during initialize, and the caller is the factory, so the factory needs a bootstrap ROLE_SET_TEXT_ADMIN that the last init call revokes. (4) It was not obvious which Sepolia deployment is live: the deployments page pins contracts-v2 at 71a3b73, while the repo's main branch carries two older sets that still have code.

Missing: an ERC-1155 receiver check or revert reason on register; a one-line note that resolver roles are per resource across the resolver; and ENSIP-25 agent-registration records only verify once a live registry lists the name, so we accept them but do not set them by default.
```

## Curvegrid ($3,000): Best AI Agent Project

Be upfront: MultiBaas is not used anywhere in the repo, and their prize page says it is not required. Judging is "based on your idea and technical execution".

**Why you're applicable**

```text
Applying for Best AI Agent Project. Soapay ships an MCP server that gives an AI agent its own pay identity (an ENSv2 name with a stealth meta-address and ENSIP-26 records) and lets it pay, get paid, find and spend USDC by name, privately, on Base Sepolia. It is a policy-aware stablecoin payment agent: every value move is a dry run, then a confirm of a single-use plan that expires in ten minutes, under per-call and per-day USDC caps, an optional payee allowlist and pinned meta-addresses, with keys that never leave the process. Agents pay each other by name the same way. Live run: an agent created mcp-agent-7c1e.soapay.eth, received 0.3 USDC through our batch contract, found it with scan, and spent 0.1 USDC to another name through a bundler and a USDC paymaster. We did not use MultiBaas; the agent talks to the chain through viem and our public SDK.
```

Strict two-sentence version, if the field enforces its limit:

```text
Soapay ships an MCP server that gives an AI agent its own pay identity (an ENSv2 name with a stealth meta-address and ENSIP-26 records) and lets it pay, get paid, find and spend USDC by name, privately, on Base Sepolia, as a policy-aware stablecoin payment agent: every value move is a dry run, then a confirm of a single-use expiring plan, under per-call and per-day caps, an optional payee allowlist and pinned meta-addresses. We did not use MultiBaas; the agent talks to the chain through viem and our public SDK, and it ran live (mcp-agent-7c1e.soapay.eth received 0.3 USDC and spent 0.1 USDC to another name).
```

**Link to the line of code**

Primary, the MCP tools (`create_agent_identity`, `pay`, `scan`, `balance`, `spend`, `swap_in_place`):

```text
https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/mcp/src/server.ts#L75-L164
```

Also: the guardrails (caps, allowlist, single-use expiring plans): https://github.com/easonchai/soapay/blob/82c09589b2a88e474c2744c146bdae39680a4a8e/apps/mcp/src/guardrails.ts#L38-L83

**How easy is it to use (1 to 10)**

We did not use MultiBaas, so we cannot rate it honestly. Leave the field at its default if the form allows. If it forces a number, put 5 and say in the feedback that it is not based on use.

**Additional feedback for the sponsor**

```text
We did not use MultiBaas, so we have no integration feedback. Our README covers the items your prize asks for: a one-sentence summary at the top, the team with GitHub and X handles at the bottom, setup under "Getting started" and test commands under "Tests". The agent is in apps/mcp, and its README has the live run.
```

## Before you submit

- **World:** run one live Proof of Human session (create at the name step, then rotate) with the World App against the running API, and fill in "Time to first success" in `docs/worldid.md`. Show the denied path in the demo video (a rotation without the session, blocked in the company app). Both are open items in `docs/bounty-integrations.md`.
- **ENS:** nothing pending. The live demo link and the public repo are already on the project page.
- **Curvegrid:** merge the README "Team" section first, since their checklist asks for the team and social handles in the README.
- The long "why applicable" blocks run past "a sentence or two". Each has a strict two-sentence version right under it for a field that enforces the limit.
