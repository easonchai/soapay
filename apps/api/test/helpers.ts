import { vi } from "vitest";
import type { Hono } from "hono";
import type { Address, Hash, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildApp, type BuildAppDeps } from "../src/app.js";
import type { HumanVerifier, NameIssuer } from "../src/hooks.js";
import type { ReadClient, WriteClient } from "../src/chain.js";
import { loadConfig, type Config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { Indexer } from "../src/indexer.js";
import type { Logger } from "../src/util.js";

export const RELAYER_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
export const REGISTRANT_KEY = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
export const OTHER_KEY = "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex;
export const NOW = 1_800_000_000;

export const registrant = privateKeyToAccount(REGISTRANT_KEY);
export const other = privateKeyToAccount(OTHER_KEY);

function compressedPub(n: number): string {
  const pub = privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}` as Hex).publicKey; // 0x04 || x || y
  const y = BigInt(`0x${pub.slice(68)}`);
  return (y % 2n === 0n ? "02" : "03") + pub.slice(4, 68);
}

/** A valid 66-byte meta-address (spend || view, compressed points) indexed by n. */
export function metaHex(n = 1): Hex {
  return `0x${compressedPub(1000 + n)}${compressedPub(2000 + n)}` as Hex;
}
/** Canonical URI form (what NameClaims are signed over and what the API stores). */
export const metaUri = (n = 1) => `st:eth:${metaHex(n)}`;

export type Fakes = {
  client: { [K in keyof ReadClient]: ReturnType<typeof vi.fn> };
  relayer: WriteClient & { writeContract: ReturnType<typeof vi.fn> };
  logs: { level: string; msg: string; fields?: Record<string, unknown> }[];
};

export function makeTestApp(
  opts: { env?: Record<string, string>; relayer?: boolean; indexer?: boolean; nameIssuer?: NameIssuer; humanVerifier?: HumanVerifier } = {},
) {
  const config: Config = loadConfig({
    RPC_URL: "http://127.0.0.1:1",
    CHAIN_ID: "84532",
    RELAYER_PRIVATE_KEY: RELAYER_KEY,
    DB_PATH: ":memory:",
    ...opts.env,
  });
  const db = openDb(":memory:");
  const logs: Fakes["logs"] = [];
  const logger: Logger = {
    info: (msg, fields) => logs.push({ level: "info", msg, ...(fields ? { fields } : {}) }),
    warn: (msg, fields) => logs.push({ level: "warn", msg, ...(fields ? { fields } : {}) }),
    error: (msg, fields) => logs.push({ level: "error", msg, ...(fields ? { fields } : {}) }),
  };
  const client = {
    readContract: vi.fn(async (_args: any): Promise<unknown> => "0x"),
    simulateContract: vi.fn(async (args: any) => ({ request: { ...args, simulated: true } })),
    waitForTransactionReceipt: vi.fn(async (_args: any): Promise<{ status: string; blockNumber: bigint }> => ({ status: "success", blockNumber: 123n })),
    getBlockNumber: vi.fn(async (): Promise<bigint> => 1000n),
    getLogs: vi.fn(async (_args: any): Promise<any[]> => []),
  };
  let n = 0;
  const relayer = {
    account: privateKeyToAccount(RELAYER_KEY),
    writeContract: vi.fn(async () => `0x${(++n).toString(16).padStart(64, "0")}` as Hash),
  };
  const indexer = opts.indexer
    ? new Indexer({
        db,
        client: client as unknown as ReadClient,
        startBlock: config.indexer.startBlock,
        chunkSize: config.indexer.chunkSize,
        pollMs: config.indexer.pollMs,
        reorgDepth: config.indexer.reorgDepth,
        logger,
      })
    : undefined;
  let ip = "10.0.0.1";
  const deps: BuildAppDeps = {
    ...(opts.nameIssuer ? { nameIssuer: opts.nameIssuer } : {}),
    ...(opts.humanVerifier ? { humanVerifier: opts.humanVerifier } : {}),
    config,
    db,
    client: client as unknown as ReadClient,
    relayer: opts.relayer === false ? undefined : (relayer as unknown as WriteClient),
    indexer,
    logger,
    now: () => NOW,
    getIp: () => ip,
  };
  const app: Hono = buildApp(deps);
  const setIp = (v: string) => (ip = v);
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { app, db, config, client, relayer, logs, deps, setIp, post, indexer };
}

/** Response.json() typed loosely for assertions. */
export const j = (r: Response): Promise<any> => r.json();
