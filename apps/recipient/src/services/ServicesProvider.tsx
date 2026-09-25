import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { getChainConfig } from "@soapay/sdk";
import { createPublicClient, getAddress, http, type Address, type Chain, type PublicClient, type Transport } from "viem";
import { createApi, type Api, type ApiFetch } from "../api/client.js";
import { ENV } from "../config.js";
import { ScanPool, browserWorkerFactory } from "../scan/pool.js";
import type { ScanClient } from "../scan/scanner.js";
import { useVault } from "../vault/VaultProvider.js";
import { defaultSettings, type Settings } from "../vault/types.js";
import { MOCK_DISPERSE, createMockFetch, createMockPublicClient, createMockSpendService, setMockIdentity } from "./mock.js";
import { createSdkSpendService, type SpendService } from "./spend.js";

export type Services = {
  mock: boolean;
  settings: Settings;
  api: Api;
  fetch: ApiFetch;
  /** Reads: block number, logs, balances, registry nonce. */
  client: ScanClient & { readContract: PublicClient["readContract"] };
  spend: SpendService;
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
      spend: createMockSpendService(),
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
    spend: createSdkSpendService({ chainId, bundlerUrl: settings.bundlerUrl, publicClient }),
    pool: pool(),
    stealthDisperse: disperse,
  };
}

export function ServicesProvider({ children, override }: { children: ReactNode; override?: Services }) {
  const vault = useVault();
  const settings = vault.data?.settings ?? defaultSettings();
  const key = JSON.stringify(settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const services = useMemo(() => override ?? buildServices(settings, ENV.mockApi), [override, key]);
  const meta = vault.keys?.metaAddressURI;
  useEffect(() => {
    if (ENV.mockApi && meta) setMockIdentity(meta);
  }, [meta]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices outside ServicesProvider");
  return s;
}
