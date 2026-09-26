import { useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import { DEFAULT_SLIPPAGE_BPS, useConvert } from "../hooks/useConvert.js";
import { Addr, Alert, Button, Card, CardHeader, Field, Input, PageHeader } from "../ui/kit.js";
import { formatUsdc } from "../ui/format.js";

const fmtOut = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 });

export function Convert() {
  const c = useConvert();
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenOut, setTokenOut] = useState(c.targets[0]?.address ?? "");
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_BPS / 100));
  const s = c.state;
  const source = from || c.sources[0]?.[0] || "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bps = Math.round(Number(slippage) * 100);
    void c.quote({ from: source, amount, tokenOut, slippageBps: Number.isFinite(bps) ? bps : -1 });
  };

  return (
    <>
      <PageHeader
        eyebrow="Convert · Uniswap"
        title="Convert"
        description="Swap part of one address's USDC into ETH that stays in that same address. Nothing moves between your addresses, so nothing gets linked."
      />
      {!c.ready && <Alert variant="warning">{c.unavailableReason}</Alert>}

      {(s.step === "form" || s.step === "quoting") && (
        <Card className="p-4 sm:p-5">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="From address">
              {({ id }) => (
                <select id={id} value={source} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 font-mono text-sm">
                  {c.sources.length === 0 && <option value="">No funded addresses</option>}
                  {c.sources.map(([a, bal]) => (
                    <option key={a} value={a}>
                      {a.slice(0, 10)}…{a.slice(-6)} · {formatUsdc(bal)} USDC
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Amount (USDC)">
                {({ id }) => <Input id={id} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />}
              </Field>
              <Field label="To">
                {({ id }) => (
                  <select id={id} value={tokenOut} onChange={(e) => setTokenOut(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
                    {c.targets.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Max slippage (%)">
                {({ id }) => <Input id={id} inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value)} />}
              </Field>
            </div>
            {s.step === "form" && s.error && <Alert variant="destructive">{s.error}</Alert>}
            <Button type="submit" className="w-full" loading={s.step === "quoting"} disabled={!c.ready}>
              Get quote
            </Button>
            <p className="text-xs text-muted-foreground">Route: {c.route}</p>
          </form>
        </Card>
      )}

      {(s.step === "review" || s.step === "swapping") && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`${formatUsdc(s.quote.amountIn)} USDC → ~${fmtOut(s.quote.amountOut)} ${s.symbol}`}
              description={<>in <Addr address={s.quote.stealthAddress} chars={6} />, output stays there</>}
            />
            <dl className="grid grid-cols-2 gap-2 px-4 py-3 text-sm">
              <dt className="text-muted-foreground">Minimum received</dt>
              <dd className="tabular-nums">
                {fmtOut(s.quote.minOut)} {s.symbol}
              </dd>
              <dt className="text-muted-foreground">Slippage</dt>
              <dd>{s.quote.slippageBps / 100}%</dd>
              <dt className="text-muted-foreground">Route</dt>
              <dd className="font-mono text-xs">{s.quote.route}</dd>
            </dl>
          </Card>
          {s.step === "review" && s.error && <Alert variant="destructive">{s.error}</Alert>}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void c.confirm()} loading={s.step === "swapping"}>
              Convert
            </Button>
            <Button variant="ghost" onClick={c.reset} disabled={s.step === "swapping"}>
              Back
            </Button>
          </div>
        </div>
      )}

      {s.step === "done" && (
        <div className="space-y-4">
          <Alert variant="success" title="Converted">
            ~{fmtOut(s.quote.amountOut)} {s.symbol} is now in <Addr address={s.quote.stealthAddress} />.
          </Alert>
          <Button variant="outline" onClick={c.reset}>
            Convert more
          </Button>
        </div>
      )}
    </>
  );
}
