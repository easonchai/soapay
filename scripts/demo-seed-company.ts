// Seeds the demo company "Meridian Labs" (ten onboarded employees) through the live API, and writes the
// roster CSV and the coworker's recovery kit. Phrases go only to git-ignored scripts/*.local.* files.
// Run from the repo root:  pnpm demo:seed-company [--dry]
// The code lives in examples/demo/ (that package has @soapay/sdk, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/seed-company.ts");
