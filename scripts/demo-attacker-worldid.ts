// The World ID failure path, scripted (docs/worldid.md, "Failure path"): a thief with the victim's stolen
// recovery phrase asks Soapay to move the victim's name to their own keys, confirming with a World ID proof
// that isn't the victim's. The API refuses (403 session_mismatch, or session_replayed with --replay) and
// nothing changes. Run from the repo root:
//   pnpm demo:attacker-worldid [label] [--replay]     (default sam-demo)
//   pnpm demo:attacker-worldid [label] --setup        (rehearsal, once: link the name to your real World ID)
// The code lives in examples/demo/ (that package has @soapay/sdk, viem, IDKit and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/worldid-attacker.ts");
