# Soapay

One name, infinite addresses. Get paid on-chain without publishing your bank statement. See [PRD.md](PRD.md).

```sh
nvm use          # Node 24
pnpm install
pnpm build && pnpm test
pnpm dev         # recipient :5173, sender :5174, gateway :8787
```

| Package | Purpose |
| --- | --- |
| `packages/sdk` | Stealth derivation, registry, announce, scan, spend (wraps ScopeLift SDK + viem) |
| `apps/recipient` | Recipient app |
| `apps/sender` | Sender app (batch pay runs) |
| `apps/gateway` | CCIP-Read gateway |
