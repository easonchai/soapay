# @soapay/api

Hono on Node 24. It runs the ERC-6538 registration relayer, stores `*.soapay.eth` name claims (on-chain issuance goes through a pluggable ENSv2 `NameIssuer`), and indexes ERC-5564 announcements. State lives in SQLite through the built-in `node:sqlite`, so there are no native dependencies. The server is esbuild-bundled, because the ScopeLift SDK can't load in plain Node.

Interface contract: `docs/mvp-spec.md` §4.

## Run

```sh
pnpm install
pnpm --filter @soapay/sdk build
cp apps/api/.env.example apps/api/.env   # fill RPC_URL, RELAYER_PRIVATE_KEY
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
| `L1_RPC_URL` | unset | For the ENSv2 issuer; the default no-op issuer ignores it |
| `PARENT_NAME` | `soapay.eth` | Used in `/names` responses |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | The SPAs |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate-limit IPs |
| `BODY_LIMIT_BYTES` | `16384` | |
| `RATE_LIMIT_WINDOW_SECONDS` | `3600` | Fixed window |
| `RATE_LIMIT_REGISTER_PER_IP` / `_PER_REGISTRANT` | `3` / `3` | |
| `RATE_LIMIT_NAMES_PER_IP` | `10` | |
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

Body: `{label, registrant, metaAddress, deadline, signature, proof?}`.

- **NameClaim.** EIP-712 domain `{name: "Soapay Names", version: "1", chainId: CHAIN_ID}`, type `NameClaim(string label,address registrant,string metaAddress,uint256 deadline)`. It is verified with `@soapay/sdk` `verifyNameClaim`. `metaAddress` is signed, stored and served in canonical `st:eth:0x<lowercase>` form.
- **Label.** Uses SDK `isValidLabel`: 3–32 of `[a-z0-9-]`, no leading or trailing hyphen, no `--` at positions 3–4.
- **Checks.** The deadline must be in the future. `stealthMetaAddressOf(registrant, 1)` must equal the meta-address (409 `meta_mismatch`). The label must be free (409 `label_taken`).
- **Updating.** The same registrant can change its meta-address with a new claim that has a later deadline (409 `stale_claim` otherwise). The change is logged as a warning and recorded in `name_history`.
- **Hooks.** The `HumanVerifier` runs with `action: "name"` for a new label and `"update-meta"` for an update, and any nullifier it returns is stored. `NameIssuer.issue` runs for a new label and `NameIssuer.updateMeta?` for an update. If the issuer throws, the response is 502 and nothing is stored.
- **Responses.** 201 when a label is created, 200 on update or an identical retry: `{label, name, registrant, metaAddress, deadline, txHash, createdAt, updatedAt}`.

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

- `NameIssuer`: `issue({label, registrant, metaAddress}) → {txHash?}`, plus an optional `updateMeta`. The default `NoopNameIssuer` only stores. The ENSv2 workstream implements the real one.
- `HumanVerifier`: `verify({action: "register" | "name" | "update-meta", registrant, proof?}) → {ok: true, nullifier?} | {ok: false, reason}`. The default allows everyone. World ID plugs in here.

Both are passed to `buildApp(deps)` in `src/index.ts`.
