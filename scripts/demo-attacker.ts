// Attacker simulation for the World ID recovery beat (docs/demo-flow.md, D-55): a stolen recovery phrase
// rewrites the victim's ENS `stealth` record on-chain, but the API refuses to attest it, so the payer blocks
// the line. Run from the repo root:  pnpm demo:attacker [label] [--restore] [--ens-only] [--no-api]
// The code lives in examples/demo/ (that package has @soapay/sdk, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/attacker.ts");
