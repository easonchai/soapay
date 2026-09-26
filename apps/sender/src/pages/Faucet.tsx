// Test USDC for the connected wallet. Demo mode: a button that credits the in-memory ledger. A real
// testnet: links to Circle's faucet (20 USDC per address per 2 hours, lib/testnet.ts) and a Base
// Sepolia ETH faucet. Mainnet: nothing. Props-only.
import { toast } from "@soapay/ui";
import { isTestnetChain } from "@soapay/sdk";
import { DEMO_FAUCET_USDC } from "../lib/demoChain.js";
import { FAUCET_USDC_PER_DRIP } from "../lib/testnet.js";
import { usdc } from "../ui/kit.js";

export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";
export const BASE_SEPOLIA_ETH_FAUCET_URL = "https://www.alchemy.com/faucets/base-sepolia";
/** "10,000": the demo drip without cents. */
const DRIP = usdc(DEMO_FAUCET_USDC).replace(/\.00$/, "");

export type FaucetProps = {
  chainId: number;
  demo: boolean;
  /** The wallet's USDC balance, when known. */
  usdcBalance?: bigint | null | undefined;
  /** Demo only: credits the demo wallet. */
  onFaucet?: (() => void) | undefined;
};

export function Faucet({ chainId, demo, usdcBalance = null, onFaucet }: FaucetProps) {
  if (demo) {
    return (
      <div className="panel panel-pad between" style={{ gap: 12, flexWrap: "wrap" }} data-testid="faucet">
        <span className="stack-sm" style={{ gap: 2 }}>
          <span style={{ fontWeight: 500 }}>Test USDC</span>
          <span className="ink2" style={{ fontSize: 12 }}>
            Demo wallet balance: <span className="mono num">{usdcBalance === null ? "…" : `${usdc(usdcBalance)} USDC`}</span>
          </span>
        </span>
        <button
          onClick={() => {
            onFaucet?.();
            toast.success(`${DRIP} USDC added`);
          }}
        >
          Get {DRIP} test USDC
        </button>
      </div>
    );
  }
  if (!isTestnetChain(chainId)) return null;
  return (
    <div className="panel panel-pad stack-sm" style={{ gap: 6 }} data-testid="faucet">
      <span style={{ fontWeight: 500 }}>Test USDC</span>
      {usdcBalance !== null && (
        <span className="ink2" style={{ fontSize: 12 }}>
          Wallet balance: <span className="mono num">{usdc(usdcBalance)} USDC</span>
        </span>
      )}
      <span className="ink2" style={{ fontSize: 12 }}>
        <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noreferrer">
          Circle&apos;s USDC faucet ↗
        </a>{" "}
        ({FAUCET_USDC_PER_DRIP} USDC per address every 2 hours) ·{" "}
        <a href={BASE_SEPOLIA_ETH_FAUCET_URL} target="_blank" rel="noreferrer">
          Base Sepolia ETH for gas ↗
        </a>
      </span>
    </div>
  );
}
