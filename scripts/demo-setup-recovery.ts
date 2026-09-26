// Creates the recovery-beat demo employee(s) through the live API (docs/demos/README.md). Phrases go only to
// the git-ignored scripts/.demo-recipients.local.json. Run from the repo root:  pnpm demo:setup-recovery [label...]
// The code lives in examples/demo/ (that package has @soapay/sdk, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/setup-recovery.ts");
