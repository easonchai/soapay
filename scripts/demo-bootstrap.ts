// Gets a clean-slate employer wallet ready for the stage demos (docs/demos/README.md): Base Sepolia ETH
// for gas, mock USDC, the seeded Meridian Labs roster, then the next clicks.
// Run from the repo root:  pnpm demo:bootstrap <employer-address> [--eth 0.05] [--usdc 100000] [--no-seed] [--dry]
// The code lives in examples/demo/ (that package has @soapay/sdk, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/bootstrap.ts");
