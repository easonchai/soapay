import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getChainConfig, type GaslessProofClient } from "@soapay/sdk";
import { createPublicClient, getAddress, http, type Address, type Chain, type PublicClient, type Transport } from "viem";
import { createApi, type Api, type ApiFetch } from "../api/client.js";
import { ENV } from "../config.js";
import { ScanPool, browserWorkerFactory } from "../scan/pool.js";
import type { ScanClient } from "../scan/scanner.js";
import { useVault } from "../vault/VaultProvider.js";
import { paymasterUrl, settingsOf, type Settings } from "../vault/types.js";
import { createEnsWriter, type EnsWriter } from "../features/rotation/ens.js";
import {
  MOCK_DISPERSE,
  createMockEnsWriter,
  createMockFetch,
  createMockPublicClient,
  createMockSpendService,
  setMockIdentity,
} from "./mock.js";
import { createSdkSpendService, type SpendService } from "./spend.js";
import { exitConfigFor } from "../features/exit/config.js";
import { createMockExitService } from "../features/exit/mock.js";
import { createSdkExitService, type ExitService } from "../features/exit/sdk.js";

export type Services = {
  mock: boolean;
  settings: Settings;
  api: Api;
  fetch: ApiFetch;
  /** Reads: block number, logs, balances, registry nonce; receipts, ETH balance, nonce and code (D-41 views). */
  client: ScanClient & GaslessProofClient & { readContract: PublicClient["readContract"] };
  spend: SpendService;
  /** Compliant exit through Privacy Pools (features/exit/sdk.ts is the SDK seam). */
  exit: ExitService;
  /** ENSv2 `stealth` record writer for rotation (Sepolia). */
  ens: EnsWriter;
  pool: ScanPool;
  /** StealthDisperse deployments whose metadata payer we trust. */
  stealthDisperse: Address[];
};

const ServicesContext = createContext<Services | null>(null);

let sharedPool: ScanPool | null = null;
function pool(): ScanPool {
  return (sharedPool ??= new ScanPool(browserWorkerFactory));
}

export function buildServices(settings: Settings, mock: boolean): Services {
  const chainId = settings.chainId;
  const disperse = [...new Set([...ENV.stealthDisperse, ...settings.stealthDisperse, ...(mock ? [MOCK_DISPERSE] : [])].map((a) => getAddress(a)))];
  if (mock) {
    const fetchFn = createMockFetch(chainId);
    return {
      mock,
      settings,
      api: createApi(settings.apiUrl, fetchFn),
      fetch: fetchFn,
      client: createMockPublicClient(chainId) as unknown as Services["client"],
      spend: createMockSpendService(chainId),
      exit: createMockExitService(),
      ens: createMockEnsWriter(),
      pool: pool(),
      stealthDisperse: disperse,
    };
  }
  const chain: Chain = getChainConfig(chainId).chain;
  const publicClient = createPublicClient({
    chain,
    transport: http(settings.rpcUrl || undefined, { batch: false, retryCount: 2 }),
  }) as PublicClient<Transport, Chain>;
  const fetchFn: ApiFetch = (i, init) => fetch(i, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });
  return {
    mock,
    settings,
    api: createApi(settings.apiUrl, fetchFn),
    fetch: fetchFn,
    client: publicClient as unknown as Services["client"],
    spend: createSdkSpendService({ chainId, bundlerUrl: settings.bundlerUrl, publicClient, paymasterUrl: paymasterUrl(settings) }),
    exit: createSdkExitService({
      config: exitConfigFor(chainId),
      bundlerUrl: settings.bundlerUrl,
      rpcUrl: settings.rpcUrl,
      fetch: fetchFn as typeof fetch,
    }),
    ens: createEnsWriter({ l1RpcUrl: settings.l1RpcUrl }),
    pool: pool(),
    stealthDisperse: disperse,
  };
}

export function ServicesProvider({ children, override }: { children: ReactNode; override?: Services }) {
  const vault = useVault();
  const settings = settingsOf(vault.data);
  const key = JSON.stringify(settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const services = useMemo(() => override ?? buildServices(settings, ENV.mockApi), [override, key]);
  // Set during render, not in an effect: child effects (the scanner's first scan) run before ours.
  const meta = vault.keys?.metaAddressURI;
  if (ENV.mockApi && meta) setMockIdentity(meta);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices outside ServicesProvider");
  return s;
}
