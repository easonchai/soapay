# @soapay/sdk

Stealth-address payments on EVM chains: key derivation, ERC-6538 registration, pay runs (StealthDisperse or an EIP-5792 batch), scanning, spending and the compliant exit. Apps import protocol logic only from here.

`@scopelift/stealth-address-sdk` must be bundled, inlined or run through tsx; plain Node can't load it.

## Beyond payroll

Payroll is one preset of a general "private distribution": a **payer** sends an asset to N **recipients**, each line to a fresh stealth address. The same invariants apply to every preset: all lines are derived first, sorted globally by stealth address, cut into roughly equal transactions (never by recipient), no ephemeral key repeats, and approvals are for the exact total.

```ts
import { dividend, denominated, planDistribution, encodeDistribution, resolveAsset, getChain } from "@soapay/sdk";

const usdc = resolveAsset(84532, "USDC");
const input = dividend(holders, 25_000_000_000n); // exact integer pro rata, sums to the total
const plan = planDistribution({ ...input, asset: usdc, split: denominated(100_000_000n) });
const calls = encodeDistribution(plan, { via: "disperse", stealthDisperse: getChain(84532).stealthDisperse! });
```

| Preset | Input | Amounts |
| --- | --- | --- |
| `payroll(recipients)` | fixed amounts | as given |
| `dividend(holders, total)` | holdings | `proRata`: floor shares, leftover units to the largest remainders; zero shares dropped with a warning |
| `grant(awards, { budget })` | fixed awards | as given, checked against the budget |
| `vesting(grantees, at)` | a `VestingSchedule` per grantee | newly vested at `at` minus `released`; `vestingSchedule(s)` lists every release |

**Adapters** (`adapters.ts`) name each integration point, with defaults that wrap existing code: `NameResolver` (`ensNameResolver`, `metaAddressResolver`, `erc6538Resolver`, `compositeResolver`), `AnnouncementSource` (`apiAnnouncementSource`, `rpcAnnouncementSource`, `fallbackAnnouncementSource`), `Signer` (`phraseSigner`, `eoaSignatureSigner`), `KeyStorage` (`memoryKeyStorage`; apps bring an encrypted local store) and `Relayer` (`apiRelayer`, `selfSubmitRelayer`, used by `registerWithRelayer`).

**Chains and assets** (`registry.ts`): `registerChain({ chain })` adds any EVM chain; the ERC-5564 Announcer and ERC-6538 Registry default to their canonical addresses, which are the same everywhere. Base and Base Sepolia are pre-registered. Assets are typed as ERC-20, native, ERC-721 or ERC-1155, but only ERC-20 is supported today: `assetCapabilities(kind)` reports what works, and the other kinds throw `UnsupportedAssetError`. A `ComplianceHook` (`canReceive(address, asset)`) is the extension point for allowlisted security tokens (ERC-3643 style); only the interface and a no-op ship, because each fresh stealth address would first need registering with the issuer's identity registry.

Headless use: `apps/cli` (`soapay distribute --csv holders.csv --asset usdc --preset dividend --total 1000`, dry run by default; `--execute` prints a preflight, approves the exact total and pays through StealthDisperse with explorer links; each name's meta-address is pinned in `.soapay/pins.json` next to the CSV and a change stops the run unless a World ID rotation attestation or `--accept-change <name>` covers it, D-49) and `examples/` (`dividend-run.ts`, `grant-round.ts`, run with `pnpm --filter @soapay/examples dividend`). `scripts/demo-pluggable.sh` runs a live Base Sepolia payout to people and an AI agent (via `apps/mcp`) in one batch; see docs/demo-flow.md Beat 4b.
