import { SOAPAY_CHAIN } from "@soapay/sdk";

// M1: paste names + amounts, resolve every run, derive client-side,
// one atomic EIP-5792 batch of USDC transfers + announcements.
export function App() {
  return (
    <main>
      <h1>Soapay</h1>
      <p>Sender app · {SOAPAY_CHAIN.name}</p>
    </main>
  );
}
