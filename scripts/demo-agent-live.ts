// The live agent beat: a real LLM agent (Claude Sonnet 5) with the Soapay MCP server as its tools.
// Run from the repo root:
//   pnpm demo:agent-live join | spend <amount> <name>   [--env <file>] [--backend cli|sdk]
// The deterministic, no-LLM version is `pnpm demo:agent`. The code lives in examples/demo/.
// Dynamic import: this folder is not an ES module package, and the demo code uses top-level await.
void import("../examples/demo/agent-live.ts");
