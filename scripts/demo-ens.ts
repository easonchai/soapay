// The ENS beat: shows, with live reads, how an employer turns a name's ENS text records into a fresh
// payment address per payment. Read-only. Run from the repo root:  pnpm demo:ens <label-or-name> [--derive N]
// The code lives in examples/demo/ (that package has @soapay/sdk, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/ens.ts");
