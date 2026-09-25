import { parseAbi } from "viem";
export { ERC5564AnnouncerAbi as announcerAbi, ERC6538RegistryAbi as registryAbi } from "@scopelift/stealth-address-sdk";

/** StealthDisperse, packed calldata (docs/mvp-spec.md §1). */
export const stealthDisperseAbi = parseAbi([
  "struct PackedPayment { uint256 head; bytes32 keyX; }",
  "function pay(address token, PackedPayment[] lines)",
  "function payWithPermit(address token, PackedPayment[] lines, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "error NotAscending(uint256 index)",
  "error BadEphemeralKey(uint256 index)",
  "error ZeroAmount(uint256 index)",
  "error PermitFailed()",
]);

/** SoapayOffchainResolver (docs/mvp-spec.md §2). */
export const offchainResolverAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function resolveWithProof(bytes response, bytes extraData) view returns (bytes)",
  "function url() view returns (string)",
  "function signers(address) view returns (bool)",
  "function setSigners(address[] signers, bool enabled)",
  "function setUrl(string url)",
  "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
]);

/** Gateway-side interface the CCIP-Read callData targets. */
export const resolverServiceAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes sig)",
]);

/** Resolver record functions the gateway answers. */
export const resolverRecordsAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
  "function addr(bytes32 node) view returns (address)",
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
]);

export const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
