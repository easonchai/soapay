---
name: scopelift-sdk-esm-quirk
description: @scopelift/stealth-address-sdk ESM build can't load in plain Node; bundle or inline it
metadata:
  type: reference
---
`@scopelift/stealth-address-sdk@1.0.0-beta.5` is `"type": "module"` but uses extensionless/directory imports, so plain Node ESM throws ERR_UNSUPPORTED_DIR_IMPORT. Vite bundles it fine. Vitest needs `server.deps.inline: ["@scopelift/stealth-address-sdk"]`. The gateway is esbuild-bundled and `contracts/tools/derive.ts` runs via tsx for the same reason.

**How to apply:** any new Node entrypoint (worker, MCP server, scripts) must be bundled or run via tsx/vitest, not executed directly with node. Useful exports: generateStealthAddress, checkStealthAddress, computeStealthKey, buildMetadataForERC20, generateSignatureForRegisterKeysOnBehalf, ERC5564_StartBlocks.BASE.
