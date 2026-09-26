// The agent beats from the terminal (docs/demo-desktop.md): drives the real Soapay MCP server over
// stdio with no LLM in the loop. Run from the repo root:
//   pnpm demo:agent init | status | join '<invite link>' | spend <amount> <name>   [--pause] [--yes]
// The code lives in examples/demo/ (that package has @soapay/sdk, the MCP SDK, viem and tsx).
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/agent.ts");
