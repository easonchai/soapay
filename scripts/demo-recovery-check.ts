// LIVE end-to-end check of the recovery beat: pin → attack → blocked → restore (docs/demo-flow.md).
// Run from the repo root:  pnpm demo:recovery-check [label]
// The code lives in examples/demo/ (that package has @soapay/sdk, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/recovery-check.ts");
