import { getAbiItem, type Address, type Hash, type Hex, type Log } from "viem";
import { ANNOUNCER_ADDRESS, REGISTRY_ADDRESS, SCHEME_ID, announcerAbi, registryAbi } from "@soapay/sdk";

/**
 * The narrow slice of a viem PublicClient the API uses. Real clients satisfy it;
 * tests pass plain objects with vi.fn() members.
 */
export type ReadClient = {
  readContract(args: any): Promise<unknown>;
  simulateContract(args: any): Promise<{ request: any }>;
  waitForTransactionReceipt(args: { hash: Hash; timeout?: number }): Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
  getBlockNumber(args?: any): Promise<bigint>;
  getLogs(args: any): Promise<Log[]>;
};

/** The slice of a viem WalletClient (with a local relayer account) the API uses. */
export type WriteClient = {
  account: { address: Address } | undefined;
  writeContract(args: any): Promise<Hash>;
};

export const announcementEvent = getAbiItem({ abi: announcerAbi, name: "Announcement" });

const SCHEME = BigInt(SCHEME_ID);

export async function readStealthMetaAddress(client: ReadClient, registrant: Address): Promise<Hex> {
  const out = (await client.readContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "stealthMetaAddressOf",
    args: [registrant, SCHEME],
  })) as Hex;
  return (out ?? "0x").toLowerCase() as Hex;
}

/** Simulates registerKeysOnBehalf from the relayer. Throws the simulation error on revert. */
export function simulateRegisterKeysOnBehalf(
  read: ReadClient,
  write: WriteClient,
  args: { registrant: Address; metaAddress: Hex; signature: Hex },
): Promise<{ request: any }> {
  return read.simulateContract({
    account: write.account,
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "registerKeysOnBehalf",
    args: [args.registrant, SCHEME, args.signature, args.metaAddress],
  });
}

export type AnnouncementRow = {
  blockNumber: bigint;
  logIndex: number;
  txHash: Hash;
  blockHash: Hash;
  stealthAddress: Address;
  caller: Address;
  ephemeralPubKey: Hex;
  metadata: Hex;
};

/** All scheme-1 Announcer logs in [fromBlock, toBlock]. Never filtered by recipient. */
export async function getAnnouncements(client: ReadClient, fromBlock: bigint, toBlock: bigint): Promise<AnnouncementRow[]> {
  const logs = (await client.getLogs({
    address: ANNOUNCER_ADDRESS,
    event: announcementEvent,
    args: { schemeId: SCHEME },
    fromBlock,
    toBlock,
    strict: true,
  })) as (Log & { args: { schemeId: bigint; stealthAddress: Address; caller: Address; ephemeralPubKey: Hex; metadata: Hex } })[];
  const rows: AnnouncementRow[] = [];
  for (const l of logs) {
    if (l.blockNumber == null || l.logIndex == null || !l.transactionHash || !l.blockHash) continue; // pending
    if (l.args.schemeId !== SCHEME) continue;
    rows.push({
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      txHash: l.transactionHash,
      blockHash: l.blockHash,
      stealthAddress: l.args.stealthAddress,
      caller: l.args.caller,
      ephemeralPubKey: l.args.ephemeralPubKey,
      metadata: l.args.metadata,
    });
  }
  return rows;
}
