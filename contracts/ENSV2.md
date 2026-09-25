# Soapay names on ENSv2 (Ethereum Sepolia)

Every employee gets a real ENSv2 subname, `label.soapay.eth`, on Ethereum Sepolia. Its `stealth` text record holds the employee's stealth meta-address. The sender app resolves the name once at enrollment and pins the meta-address (CLAUDE.md, threat model).

There is no custom contract and no gateway signer. Every call below hits the live ENSv2 beta deployment, and `test/ENSv2Names.fork.t.sol` checks the full lifecycle against it on a Sepolia fork.

| Code | What |
| --- | --- |
| [`packages/sdk/src/ensv2.ts`](../packages/sdk/src/ensv2.ts) | Addresses, role ids, call builders, reads, `createEnsV2NameIssuer` (viem only, loads in plain Node, subpath `@soapay/sdk/ensv2`) |
| [`packages/sdk/test/ensv2.test.ts`](../packages/sdk/test/ensv2.test.ts) | Unit tests: calldata, salts, predicted proxy addresses |
| [`test/ENSv2Names.fork.t.sol`](test/ENSv2Names.fork.t.sol) | Sepolia fork: buy the parent through the real registrar, set up, issue, resolve, rotate, revoke |
| [`tools/ensv2-register-parent.ts`](tools/ensv2-register-parent.ts) | Step 1: register `soapay.eth` |
| [`tools/ensv2-setup-parent.ts`](tools/ensv2-setup-parent.ts) | Step 2: subname registry and the issuer role |
| [`tools/ensv2-issue-demo.ts`](tools/ensv2-issue-demo.ts) | Step 3: issue, resolve, rotate, resolve again |

## 1. Deployment set

ENSv2 beta on Sepolia, chain `11155111` (`ensdomains/contracts-v2` @ `71a3b73`, deployed 2026-09-15, listed under "Sepolia (ENSv2 Beta)" on docs.ens.domains/learn/deployments). Each address was checked with `eth_getCode`. The same set lives in `ENSV2_SEPOLIA` in the SDK.

| Contract | Address | Used for |
| --- | --- | --- |
| RootRegistry | `0x9703DBD26dAB89504490994138cF2c575251a9cE` | Start of the registry walk |
| ETHRegistry (`.eth` PermissionedRegistry) | `0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E` | Holds `soapay.eth`; `setSubregistry` |
| ETHRegistrar | `0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca` | Commit/reveal purchase of `soapay.eth` |
| VerifiableFactory | `0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C` | Deploys the registry and resolver proxies (`deployProxy`, `verifyContract`) |
| UserRegistry implementation | `0xA80338aAA8D23831cEa25E858D1774534aBb0263` | Subname registry for `soapay.eth` |
| PermissionedResolver implementation | `0x14F09Fd05d4585759e54844DC9B00147131Cf243` | One resolver per employee |
| Universal Resolver (viem default) | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | `getEnsText`, `getEnsAddress`; proxies to V2 |
| UniversalResolverV2 | `0x5d25C1D6aCBb71B7a28AA7899618a3412a8303e3` | Implementation behind the proxy |
| MockUSDC (registrar payment token) | `0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e` | Pays for `soapay.eth`; public `mint` |

Soapay deploys two kinds of proxy, both through the VerifiableFactory so anyone can check the implementation with `verifyContract`:

- **one UserRegistry** for `soapay.eth`, with salt `keccak256(abi.encode(keccak256("UserRegistry"), namehash("soapay.eth"), 0))`;
- **one PermissionedResolver per employee**, with salt `nameResolverSalt(name, registrant, stealthWriter, keccak256(metaURI), registryResource)`. The address is predictable (`predictProxyAddress`), so a retry after a failed `register` reuses the resolver. The registry resource changes on every revoke, so a re-issued name gets a fresh resolver.

## 2. Role model

ENSv2 uses Enhanced Access Control (EAC). Roles are per *resource*: resource `0` is the contract root and covers everything. A resolver's text resource for key `k` is `keccak256(abi.encodePacked(k))`, scoped to the whole resolver, not to one name.

That scoping is why **every employee gets their own resolver**. If two employees shared one, `ROLE_SET_TEXT` on the `stealth` resource would let each of them overwrite the other's record.

| Who | Contract | Resource | Roles |
| --- | --- | --- | --- |
| `soapay.eth` owner (the company) | ETHRegistry | `soapay.eth` token | The roles the ETHRegistrar grants a registrant, including `ROLE_SET_SUBREGISTRY` (used in step (b)) |
| `soapay.eth` owner | UserRegistry | root | `ALL_ROLES` (every role and admin role) |
| API issuer key | UserRegistry | root | `ROLE_REGISTRAR` (`1 << 0`) **only** |
| `soapay.eth` owner | each PermissionedResolver | root | `ALL_ROLES` |
| Stealth writer (the registrant by default) | its own PermissionedResolver | `keccak256("stealth")` | `ROLE_SET_TEXT` (`1 << 4`) **only** |
| Registrant | UserRegistry | its subname token | **none** (role bitmap `0`) |
| VerifiableFactory | each PermissionedResolver | root | none: its bootstrap role is revoked inside `initialize` |
| Issuer, coworkers, anyone else | PermissionedResolver | any | none |

What follows from this:

- **The subname is non-transferable.** The registrant owns the ERC-1155 token but lacks `ROLE_CAN_TRANSFER_ADMIN`. It can't set a resolver or subregistry, and it can't unregister.
- **The registrant can write `stealth` and nothing else.** It can't touch `soapay:registrant`, `addr` or any other record.
- **`addr` is never set.** Plain wallets can't send to a static address for the name. Only a stealth-aware sender works.
- **The issuer can register new labels and that's all.** It can't change existing records or revoke names.
- **Names never expire.** Expiry is `2^64 - 1`. The parent revokes with `unregister`, which it can do because it holds `ROLE_UNREGISTER` on root.

The fork test asserts these roles, including the negative cases (`test_fork_fullLifecycle`, `test_fork_rolesDoNotCrossNames`, `test_fork_stealthWriterGuard`, `test_fork_registrantRotatesStealthAfterIssuance`).

## 3. The calls

All builders are in `packages/sdk/src/ensv2.ts` and return `{to, data}`.

**(a) Buy the parent** (owner, once): `tools/ensv2-register-parent.ts`

1. `MockUSDC.mint(owner, price)` if the balance is short, then `MockUSDC.approve(ETHRegistrar, price)`. The price is `getRegisterPrice(label, duration, MockUSDC)` = base + premium; it was 8.000021 MockUSDC for 365 days on 2026-09-25.
2. `ETHRegistrar.commit(makeCommitment(label, owner, secret, subregistry=0, resolver=0, duration, referrer=0))`.
3. Wait until chain time is past commit time + `MIN_COMMITMENT_AGE` (60 s).
4. `ETHRegistrar.register(label, owner, secret, 0, 0, duration, MockUSDC, 0)`.

The parent gets **no resolver**. A parent resolver could answer through ENSIP-10 wildcard resolution for a revoked subname.

> [!WARNING]
> ENSv2 mints names with an ERC-1155 **safe** transfer. If the owner address has code, it must implement `onERC1155Received`. The public anvil/hardhat test keys (`0xf39F…2266` and friends) carry EIP-7702 delegations on Sepolia that don't, and `register` then reverts with no reason. The scripts check this up front (`assertCanHoldNames`). Use a fresh EOA.

**(b) Set up the subname registry** (owner, once): `tools/ensv2-setup-parent.ts`. Each step is skipped when it's already done.

1. `VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize([{owner, ALL_ROLES}]))` (`buildDeploySubnameRegistryCall`).
2. `ETHRegistry.setSubregistry(labelhash("soapay"), registry)` (`buildSetSubregistryCall`).
3. `registry.setParent(ETHRegistry, "soapay")` (`buildSetParentCall`), the canonical-parent back-pointer.
4. `registry.grantRootRoles(ROLE_REGISTRAR, issuer)` (`buildGrantIssuerRoleCall`).

**(c) Issue `label.soapay.eth`** (issuer, two txs per employee): `createEnsV2NameIssuer(...).issue({label, registrant, metaAddress})`

1. `VerifiableFactory.deployProxy(PermissionedResolverImpl, salt, initialize(grants, calls))` (`buildDeployNameResolverCall`):
   - grants: `{admin: ALL_ROLES}` plus a bootstrap `{factory: ROLE_SET_TEXT_ADMIN}`. `grantSetterRoles` checks the *caller's* admin roles even during initialization, and the caller is the factory;
   - calls, in order: `setText(name, "stealth", metaURI)`, `setText(name, "soapay:registrant", registrant)`, `grantSetterRoles(setText(name,"stealth",""), stealthWriter)`, `revokeRootRoles(ROLE_SET_TEXT_ADMIN, factory)`.
2. `registry.register(label, registrant, subregistry=0, resolver, roleBitmap=0, expiry=2^64-1)` (`buildRegisterSubnameCall`).

The records exist before the name does, so the name is never visible half-configured.

**(d) Rotate** (stealth writer): `resolver.setText(dnsEncode(name), "stealth", newMetaURI)` (`buildSetStealthRecordCall`). The parent can hand the writer role to a guard contract later (`buildGrantStealthWriterCall`, `buildRevokeStealthWriterCall`).

**(e) Revoke** (owner): `registry.unregister(labelhash(label))` (`buildRevokeCall`).

**(f) Resolve** (sender app, anyone): viem `getEnsText({name, key: "stealth"})` through the Universal Resolver `0xeEeE…EeEe`. That is viem's default on Sepolia, so no custom resolver address is needed.

## 4. Trust analysis

Under the agreed threat model the adversary is a coworker; the employer and its admins are trusted.

| Actor | Can | Can't |
| --- | --- | --- |
| Coworker | Read every name and record (all public) | Write any record, register or revoke names |
| API issuer key (hot key on the server) | Register new labels under `soapay.eth` | Change or delete existing records, revoke names, touch `soapay.eth` itself. **A leaked issuer key** can register junk or squat labels. The owner revokes the key and unregisters the junk; existing employees are unaffected |
| Registrant key (employee) | Rotate its own `stealth` record | Transfer the name, change `soapay:registrant`, set `addr`, touch anyone else's name |
| Stolen registrant key | Point `stealth` at the thief's meta-address | Get paid: the sender app blocks a changed pin unless it carries a World ID attestation (§5) or the employer approves it |
| `soapay.eth` owner (company) | Everything: revoke names, rewrite any record, re-point the subregistry | Nothing is out of reach. This is intended: the employer is trusted |
| ENS DAO / ENSv2 contracts | Upgrade the beta contracts | We accept this for a testnet beta. The sender's pin catches any silent change |

ENS is a reference identifier, not the source of truth for payment. The sender pins the meta-address at enrollment and cross-checks it against the ERC-6538 registry on Base (`resolveStealthMeta`). Any change to `stealth` shows up as a pin change.

## 5. Rotation under option A

World ID 4.0 proofs can't be verified on-chain on Sepolia, so the **registrant keeps the `stealth` writer role** and the **sender app enforces the check** (docs/mvp-spec.md §2.1):

1. **Recipient app:** runs `proveSession(session_id)` and sends `POST /names/:label/rotation` with `{newMeta, deadline, registrantSig (EIP-712 RotationClaim), worldIdResult, registerKeysOnBehalf signature for the new meta}`.
2. **API:**
   - checks that the session matches the enrolled one, that the nullifier is unused, and that the claim signature is valid;
   - signs a `MetaRotation` attestation with `ATTESTER_PRIVATE_KEY`;
   - relays the ERC-6538 `registerKeysOnBehalf` on Base, so the registry cross-check keeps passing;
   - tops up the registrant's Sepolia gas.
3. **Registrant:** sends `setText(stealth)` on its own resolver. `tools/ensv2-issue-demo.ts` step 4 runs exactly this.
4. **Sender app:** re-resolves before each run. A changed pin is auto-accepted only with a valid attestation from the pinned attester; otherwise the employer approves it by hand.

## 6. Team runbook: real Sepolia

**Who owns what**

| Key | Holder | Env var | Needs |
| --- | --- | --- | --- |
| `soapay.eth` owner | Team multisig signer or one lead, kept offline | `PARENT_OWNER_PRIVATE_KEY` (scripts only) | ~0.01 Sepolia ETH. A **plain EOA** (see the warning in §3) |
| API issuer | The API server | `ISSUER_PRIVATE_KEY` | Sepolia ETH for 2 txs per employee (resolver deploy + register) plus the registrant gas top-ups under option A |

Moving control to a Safe later means granting the Safe `ALL_ROLES` on the UserRegistry root and on each resolver, and moving the `soapay.eth` token. This path is untested; rehearse it on a fork first.

**Order of scripts** (from `contracts/`; each takes about a minute on Sepolia):

```bash
export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # or your own RPC
export PARENT_OWNER_PRIVATE_KEY=0x...   # soapay.eth owner
export ISSUER_ADDRESS=0x...             # address of the API's ISSUER_PRIVATE_KEY
# optional: PARENT_LABEL=soapay (default), REGISTER_DAYS=365

pnpm ensv2:register-parent   # 1. commit, wait 60 s, register soapay.eth (mints MockUSDC to pay)
pnpm ensv2:setup-parent      # 2. UserRegistry, setSubregistry, setParent, grant ROLE_REGISTRAR
                             #    prints ENS_SUBNAME_REGISTRY and ENS_RESOLVER_ADMIN for the API
ISSUER_PRIVATE_KEY=0x... pnpm ensv2:issue-demo alice   # 3. optional smoke test
```

If `soapay.eth` is taken, set `PARENT_LABEL` to another label and use the same value for the API's `PARENT_NAME`.

**How the API issuer gets its role.** Step 2 runs `grantRootRoles(ROLE_REGISTRAR, ISSUER_ADDRESS)` on the UserRegistry. That is the issuer's only role, and the script prints `issuer root roles 0x1`. To rotate the issuer key, run step 2 again with the new address, then have the owner send `buildRevokeIssuerRoleCall` for the old one.

**API env** (`apps/api/.env.example` has `L1_RPC_URL` and `PARENT_NAME`; add the rest): `L1_RPC_URL` (Sepolia), `ISSUER_PRIVATE_KEY`, `PARENT_NAME=soapay.eth`, and optionally `ENS_SUBNAME_REGISTRY` and `ENS_RESOLVER_ADMIN` from step 2's output (otherwise they're looked up on-chain). The issuer is created with `createEnsV2NameIssuer({walletClient, publicClient, parent, registry?, resolverAdmin?})`. The API uses it when `ISSUER_PRIVATE_KEY` and `L1_RPC_URL` are set (`apps/api/src/issuer.ts`), and otherwise falls back to the store-only no-op issuer with a startup warning. It has no `updateMeta`: the registrant writes `stealth` itself.

**Anvil rehearsal** (no real funds):

```bash
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --port 8747 --block-time 2
cast wallet new   # twice: owner and issuer. Do NOT use anvil's default keys (7702-delegated on Sepolia)
cast rpc --rpc-url http://127.0.0.1:8747 anvil_setBalance <addr> 0x56BC75E2D63100000   # each
SEPOLIA_RPC_URL=http://127.0.0.1:8747 ...  # then the same three commands
```

Captured run (2026-09-25, anvil fork of Sepolia):

```text
register soapay.eth for 0x75Cc3A62019eab0f4B058464E449210204e95de5
  price 8000021 MockUSDC units for 365 days; commitment age 60s
  ok  MockUSDC.mint / MockUSDC.approve(ETHRegistrar, price) / ETHRegistrar.commit
  ok  ETHRegistrar.register(soapay)
done: soapay.eth owned by 0x75Cc…5de5, expires 2027-09-25T14:19:45.000Z

setup soapay.eth (owner 0x75Cc…5de5), issuer 0xDB8a…cE77
  ok  deploy UserRegistry -> 0x4c1eD0746AA30835421b963d0D6799353B8057e2
  ok  ETHRegistry.setSubregistry(soapay) / registry.setParent / registry.grantRootRoles(ROLE_REGISTRAR, issuer)
done: registry 0x4c1e…57e2; issuer root roles 0x1 (expect 0x1)

issue alice.soapay.eth as 0xDB8a…cE77
  ok  resolver deploy / register; resolver 0xc59e0b60386205044805f6DF9c13E5fD231c1Da2
  alice.soapay.eth: stealth=st:eth:0x02fa41…366f3c  soapay:registrant=0xDBD5…060c addr=(unset)
  ok  gas top-up -> registrant; ok registrant setText(stealth)
  alice.soapay.eth: stealth=st:eth:0x03b46c…4a65ba  (rotated, resolved through 0xeEeE…EeEe)
done: alice.soapay.eth issued and rotated.
```

**Fork test**

```bash
cd contracts
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com forge test --match-contract ENSv2 -vv
```

Without `SEPOLIA_RPC_URL` the fork tests skip.
