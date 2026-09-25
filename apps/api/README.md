# @soapay/api

Hono on Node 24. It runs the ERC-6538 registration relayer, stores `*.soapay.eth` name claims and issues them on ENSv2 Sepolia, verifies World ID sessions for key rotation and signs the rotation attestations, proxies the Uniswap Trading API, and indexes ERC-5564 announcements. State lives in SQLite through the built-in `node:sqlite`, so there are no native dependencies. The server is esbuild-bundled, because the ScopeLift SDK can't load in plain Node.

Interface contract: `docs/mvp-spec.md` §2.1, §4 and §5. World ID design: [`docs/worldid.md`](../../docs/worldid.md).

## Run

```sh
pnpm install
pnpm --filter @soapay/sdk build
cp apps/api/.env.example apps/api/.env   # fill RPC_URL, RELAYER_PRIVATE_KEY, WORLD_RP_SIGNING_KEY, ATTESTER_PRIVATE_KEY
pnpm --filter @soapay/api dev            # tsx watch
pnpm --filter @soapay/api build && node --env-file=apps/api/.env apps/api/dist/index.js
pnpm --filter @soapay/api test           # vitest, in-memory sqlite, mocked viem clients
```

Docker (build from the repo root; the DB lives on a volume):

```sh
docker build -f apps/api/Dockerfile -t soapay-api .
docker run -p 8787:8787 -v soapay-data:/data --env-file apps/api/.env soapay-api
```

## Env

| Var | Default | Notes |
| --- | --- | --- |
| `RPC_URL` | required | Base / Base Sepolia RPC. `sepolia.base.org` caps `eth_getLogs` at 1,000 blocks, which makes the backfill slow; use a provider with bigger ranges |
| `CHAIN_ID` | `84532` | Must be in `@soapay/sdk` `CHAINS` |
| `PORT` | `8787` | |
| `DB_PATH` | `./data/soapay.db` | `/data/soapay.db` in Docker |
| `RELAYER_PRIVATE_KEY` | unset | Unset → `POST /register` returns 503 |
| `L1_RPC_URL` | unset | Ethereum Sepolia RPC: ENSv2 issuer and rotation gas top-up |
| `PARENT_NAME` | `soapay.eth` | Subnames are issued under it |
| `ISSUER_PRIVATE_KEY` | unset | With `L1_RPC_URL`, `POST /names` issues `<label>.soapay.eth` on ENSv2 Sepolia through `@soapay/sdk/ensv2`. Unset → names are stored only, with a startup warning. Needs only `ROLE_REGISTRAR` on the subname registry, and never writes `stealth` |
| `ENS_SUBNAME_REGISTRY`, `ENS_RESOLVER_ADMIN` | looked up on-chain | Printed by `ensv2:setup-parent` (step 2 of [`contracts/ENSV2.md`](../../contracts/ENSV2.md)) |
| `WORLD_APP_ID` | `app_0cc7167efe114ac2e0ef7d9827098353` | Soapay's Developer Portal app (public) |
| `WORLD_RP_ID` | `rp_3ede5fe1cab9af48` | Soapay's World ID 4.0 RP (public) |
| `WORLD_RP_SIGNING_KEY` | required unless disabled | RP signer. Server-only, never logged or returned; keep it out of git |
| `WORLD_ENV` | `staging` | `staging` (simulator, the demo), `production` (World App) or `sandbox` (Selfie Check sandbox). Proofs from another environment are refused |
| `WORLD_ID_DISABLED` | `false` | `true` runs without World ID: no sessions and no attestations, so every meta change needs the employer's approval |
| `WORLD_RP_TTL_SECONDS` | `300` | RP context lifetime |
| `WORLD_ATTACH_COOLDOWN_SECONDS` | `259200` (72 h) | A session attached after enrollment can back a rotation only after this delay |
| `RATE_LIMIT_RP_CONTEXT_PER_IP` | `60` | Per window |
| `ATTESTER_PRIVATE_KEY` | unset | Signs `MetaRotation` attestations. Unset → rotation returns 503. Sender apps pin its address (`VITE_ATTESTER`) |
| `L1_RELAYER_PRIVATE_KEY` | unset | Sepolia gas top-up for the registrant's own `setText` after a rotation. Unset → no top-ups |
| `TOPUP_GAS` / `TOPUP_CAP_WEI` | `150000` / `2000000000000000` | Top-up = shortfall of `gas × maxFeePerGas`, never above the cap |
| `TOPUP_PER_REGISTRANT_PER_DAY` / `TOPUP_PER_DAY` | `3` / `100` | |
| `UNISWAP_API_KEY` | unset | Trading API key for the `/uniswap/*` proxy. Unset → 503 `uniswap_disabled`, and the SDK falls back to the Universal Router |
| `UNISWAP_API_URL` | `https://trade-api.gateway.uniswap.org/v1` | |
| `RATE_LIMIT_UNISWAP_PER_IP_PER_MINUTE` | `30` | |
| `UNISWAP_BODY_LIMIT_BYTES` | `8192` | |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | The SPAs |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate-limit IPs |
| `BODY_LIMIT_BYTES` | `16384` | |
| `RATE_LIMIT_WINDOW_SECONDS` | `3600` | Fixed window |
| `RATE_LIMIT_REGISTER_PER_IP` / `_PER_REGISTRANT` | `3` / `3` | |
| `RATE_LIMIT_NAMES_PER_IP` | `10` | Also covers `/names/:label/session` and `/rotation` |
| `INDEXER_ENABLED` | `true` | |
| `INDEXER_START_BLOCK` | Announcer start block for the chain | |
| `INDEXER_CHUNK_SIZE` | `10000` | Max `getLogs` range, halved on provider range errors (persisted) |
| `INDEXER_POLL_MS` | `4000` | |
| `INDEXER_REORG_DEPTH` | `10` | Blocks re-scanned behind the head on every poll |
| `RECEIPT_TIMEOUT_MS` | `60000` | After this, `/register` returns 202 `pending` |

Config errors print one clear line and exit 1. Private keys are never echoed.

## Routes

Errors use the shape `{"error": {"code": "...", "message": "..."}}`.

### `GET /health`

```json
{"ok": true, "chainId": 84532, "indexerHead": "7568279", "latestBlock": "47287755", "lag": 39719476}
```

`indexerError` is included while the indexer is failing.

### `POST /register`

Body: `{registrant, metaAddress, signature, proof?}`. `metaAddress` is `st:<chain>:0x…` or raw hex, 66 bytes, and both keys must be valid compressed points. `signature` is the registrant's ERC-6538 `Erc6538RegistryEntry` EIP-712 signature (SDK `signRegisterKeysOnBehalf`).

The flow runs in this order:

1. Validate the body.
2. Idempotency check: a repeat of a registration already relayed returns the stored tx. Concurrent identical requests share one tx.
3. Rate limit per IP and per registrant.
4. Return 409 `already_registered` if `stealthMetaAddressOf(registrant, 1)` already equals the meta-address.
5. Run the `HumanVerifier` (`action: "register"`).
6. Simulate `registerKeysOnBehalf`, then send it from the relayer. Sends are serialised, one nonce sequence.
7. Wait for the receipt and return 200 `{txHash, status: "success"}`. It returns 202 when the receipt is still pending, 400 `registration_rejected` when the simulation reverts, and 502 when the tx reverts.

```sh
curl -X POST localhost:8787/register -H 'content-type: application/json' \
  -d '{"registrant":"0x…","metaAddress":"st:eth:0x02…","signature":"0x…"}'
```

### `POST /names`

Body: `{label, registrant, metaAddress, deadline, signature, worldIdSession?, proof?}`.

- **NameClaim.** EIP-712 domain `{name: "Soapay Names", version: "1", chainId: CHAIN_ID}`, type `NameClaim(string label,address registrant,string metaAddress,uint256 deadline)`. It is verified with `@soapay/sdk` `verifyNameClaim`. `metaAddress` is signed, stored and served in canonical `st:eth:0x<lowercase>` form.
- **Label.** Uses SDK `isValidLabel`: 3–32 of `[a-z0-9-]`, no leading or trailing hyphen, no `--` at positions 3–4.
- **Checks.** The deadline must be in the future. `stealthMetaAddressOf(registrant, 1)` must equal the meta-address (409 `meta_mismatch`). The label must be free (409 `label_taken`).
- **Updating.** The same registrant can change its meta-address with a new claim that has a later deadline (409 `stale_claim` otherwise). The change is logged as a warning and recorded in `name_history`.
- **Hooks.** The `HumanVerifier` runs with `action: "name"` for a new label and `"update-meta"` for an update, and any nullifier it returns is stored. `NameIssuer.issue` runs for a new label and `NameIssuer.updateMeta?` for an update. If the issuer throws, the response is 502 and nothing is stored.
- **World ID (optional).** `worldIdSession` is an IDKit Selfie Check session result (created with `signal = sessionSignal(label, registrant)`). It's verified with the Developer Portal before anything is issued, and its `session_id` is bound to the name. Not allowed on updates; use `POST /names/:label/session`.
- **Responses.** 201 when a label is created, 200 on update or an identical retry: `{label, name, registrant, metaAddress, deadline, txHash, createdAt, updatedAt, worldIdSession: {attachedAt} | null}`. The session id itself is never served.

### `GET /worldid/config`

`{enabled, app_id, rp_id, environment, credential: "selfie", attach_cooldown_seconds, attester}`. Never includes the signing key.

### `POST /worldid/rp-context`

Body `{}` or `{kind: "session"}`. Returns `{rp_context: {rp_id, nonce, created_at, expires_at, signature}, app_id, environment, kind: "session"}`, a fresh `signRequest` signature for one IDKit session request (sessions take no action). Each nonce is accepted once. 503 when World ID is disabled.

### `POST /names/:label/session`

Attaches a Selfie Check session to a name claimed without one. Body `{deadline, signature, worldIdResult}`: `signature` is the registrant's EIP-712 `AttachSession(string label, string sessionId, uint256 deadline)` in the Soapay Names domain (SDK `attachSessionTypedData`); `worldIdResult` is a new session created with `signal = sessionSignal(label, registrant)`. 201 `{label, sessionId, attachedAt, rotationAllowedFrom}`. A name keeps its first session (409 `session_exists`), a session backs one name (409 `session_taken`), and a late-attached session backs a rotation only after `WORLD_ATTACH_COOLDOWN_SECONDS`.

### `POST /names/:label/rotation`

Key rotation, option A (`docs/mvp-spec.md` §2.1). Body `{newMeta, deadline, registrantSig, registerSig, worldIdResult}`:

- `registrantSig`: EIP-712 `RotationClaim(string label, string oldMeta, string newMeta, uint256 deadline)`, Soapay Names domain, from the name's registrant key.
- `registerSig`: the registrant's ERC-6538 `registerKeysOnBehalf` signature for `newMeta`.
- `worldIdResult`: `proveSession(savedSessionId)` with `signal = rotationSignal(label, newMeta, deadline)`.

The API checks the deadline, the rate limit and the RotationClaim, then that the proof's `session_id` is the one bound to the name, that its `session_nullifier` and RP nonce are unused, and that the Developer Portal verifies it in `WORLD_ENV`. It then simulates the registry call (a bad `registerSig` fails here, without burning the proof), signs the `MetaRotation(string label, string oldMeta, string newMeta, uint256 verifiedAt)` attestation (Soapay Attestations domain), updates the stored meta-address, relays `registerKeysOnBehalf` through the same relayer queue as `/register` (it doesn't count against anything `/register` limits), and tops up the registrant's Sepolia gas.

201 `{attester, attestation: {label, oldMeta, newMeta, verifiedAt, signature}, registry: {status, txHash?}, topup: {status, …}}`. Re-sending the same request after success returns 200 `{…, idempotent: true}` and only finishes the registry relay (no second proof).

Refusals, all without an attestation (the sender app then blocks the line until the employer approves): 409 `no_session`, 409 `session_cooldown`, 403 `session_mismatch` (a different person), 403 `session_replayed`, 403 `request_used` / `request_expired` / `unknown_request`, 403 `proof_cancelled` / `proof_missing` / `proof_malformed`, 403 `environment_mismatch`, 403 `wrong_credential` (not Selfie Check), 403 `signal_mismatch`, 403 `proof_invalid` (Portal rejected), 503 `worldid_unavailable`, 400 `expired`, 401 `bad_signature`, 400 `registration_rejected`, 409 `no_change` / `stale_rotation`, 429 `rate_limited`.

### `GET /names/:label/attestations`

`{attester, items: [{label, oldMeta, newMeta, verifiedAt, signature}]}`, newest first. Clients must pin the attester address themselves rather than trust this field.

### `POST /uniswap/:endpoint`

Trading API proxy for `quote`, `swap` and `check_approval` only (anything else is 404). It forwards the JSON body to `UNISWAP_API_URL/<endpoint>` with the server's `x-api-key` and only the `x-universal-router-version`, `x-agent-info` and `x-permit2-disabled` request headers, and passes the upstream status and body through. Bodies are capped (`UNISWAP_BODY_LIMIT_BYTES`), requests are rate-limited per IP per minute, and bodies are never logged (they contain the stealth address). Without a key: 503 `{code: "uniswap_disabled", error: {…}}`, on which the SDK's `quoteSwapInPlace` falls back to the Universal Router. Point the SDK at it with `apiUrl: "<api>/uniswap"`.

### `GET /names/:label`

Returns the same record, or 404.

### `GET /announcements?from=&to=&cursor=&limit=`

`fromBlock` and `toBlock` are accepted as aliases. `limit` defaults to 500 and is capped at 2000. The response lists all scheme-1 announcements, never filtered by recipient, in ascending (blockNumber, logIndex) order:

```json
{
  "items": [{"blockNumber": "7600123", "txHash": "0x…", "logIndex": 4, "stealthAddress": "0x…",
             "caller": "0x…", "ephemeralPubKey": "0x02…", "metadata": "0x…"}],
  "nextCursor": "7600123:4",
  "head": "7610000"
}
```

`nextCursor` is opaque, and it is `null` on the last page. `head` is the last fully indexed block, omitted when no indexer runs.

```sh
curl 'localhost:8787/announcements?from=7552655&limit=100'
```

## Indexer

The indexer backfills Announcer logs (`schemeId = 1`) from the start block in chunks, halving the chunk on RPC range errors. It then polls the tip every `INDEXER_POLL_MS`. On every poll it re-scans the last `INDEXER_REORG_DEPTH` blocks. Each chunk atomically replaces its block range, which drops reorged-out logs and upserts by `(txHash, logIndex)`, and advances `indexer_state`, so a restart resumes where it stopped.

## Plug-in points (`src/hooks.ts`)

- `NameIssuer`: `issue({label, registrant, metaAddress}) → {txHash?}`, plus an optional `updateMeta`. `src/issuer.ts` picks the ENSv2 issuer (`createEnsV2NameIssuer` from `@soapay/sdk/ensv2`) when `ISSUER_PRIVATE_KEY` and `L1_RPC_URL` are set, else `NoopNameIssuer`. The ENSv2 adapter has no `updateMeta` on purpose: the registrant writes `setText` itself, and the API's part of a change is the attestation plus top-up in the rotation route.
- `HumanVerifier`: `verify({action: "register" | "name" | "update-meta", registrant, proof?, …}) → {ok: true, nullifier?} | {ok: false, reason}`. The default allows everyone: there is no enrollment gate (`docs/mvp-spec.md` §5). It stays as a seam for, say, employer invite links.

Both are passed to `buildApp(deps)` in `src/index.ts`. World ID lives in `src/worldid/` (`verifier.ts`, `portal.ts`), the shared relayer in `src/relay.ts`, the top-up in `src/topup.ts`, and the routes in `src/routes/{worldid,rotation,uniswap}.ts`.
