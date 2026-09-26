import { useState, type FormEvent } from "react";
import type { AddressLabel } from "@soapay/sdk";
import { Trash2 } from "lucide-react";
import { Stagger, StaggerItem, toast } from "@soapay/ui";
import { LABEL_OPTIONS, useLabels } from "../hooks/useLabels.js";
import { Addr, Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, cn, errorMessage } from "../ui/kit.js";

/** What each label means to the guard, in the owner's terms. */
const LEGEND: { t: string; d: string }[] = [
  { t: "Main wallet", d: "An address people know is yours: ENS, socials, past payments." },
  { t: "Exchange", d: "A deposit address. The exchange knows your identity." },
  { t: "Other", d: "Not tied to you publicly. Direct sends are fine." },
];

export function Labels() {
  const { rows, setLabel, remove } = useLabels();
  const [address, setAddress] = useState("");
  const [label, setLabelValue] = useState<AddressLabel>("main-wallet");
  const [error, setError] = useState<string | null>(null);
  // The row just saved gets the flash so the eye lands on it.
  const [fresh, setFresh] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setLabel(address, label);
      setFresh(address.trim().toLowerCase());
      setAddress("");
      toast.success("Label saved");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Labels"
        title="Labels"
        description="Tell the privacy guard which addresses identify you. Sending to them, or linking them to your payments, gets flagged or blocked."
      />
      <div className="space-y-4">
        <Card className="p-4 sm:p-5">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <Field label="Address">
              {({ id }) => <Input id={id} className="font-mono" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} />}
            </Field>
            <Field label="Label">
              {({ id }) => (
                <select
                  id={id}
                  value={label}
                  onChange={(e) => setLabelValue(e.target.value as AddressLabel)}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  {LABEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button type="submit">Save</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">{LABEL_OPTIONS.find((o) => o.value === label)?.hint}</p>
          {error && (
            <Alert variant="destructive" className="mt-3">
              {error}
            </Alert>
          )}
        </Card>
        <div className="legend">
          {LEGEND.map((l) => (
            <div key={l.t} className="opt">
              <span>
                <span className="t">{l.t}</span>
                <span className="d" style={{ display: "block" }}>
                  {l.d}
                </span>
              </span>
            </div>
          ))}
        </div>
        <Card>
          <CardHeader title="Labelled addresses" />
          {rows.length === 0 ? (
            <EmptyState eyebrow="No labels yet" title="Start with your main wallet.">
              Coworkers probably know it. Sending there identifies the cluster.
            </EmptyState>
          ) : (
            <Stagger>
              <ul className="divide-y" data-testid="labels">
                {rows.map((r, i) => (
                  <li key={r.address} className={cn(r.address.toLowerCase() === fresh && "flash")}>
                    <StaggerItem index={i} className="flex items-center justify-between gap-2 px-4 py-2">
                      <span className="flex items-center gap-2">
                        <Addr address={r.address} chars={6} />
                        <Badge tone={r.label === "other" ? "neutral" : "warning"}>{LABEL_OPTIONS.find((o) => o.value === r.label)?.title}</Badge>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => void remove(r.address)} aria-label={`Remove label for ${r.address}`}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </StaggerItem>
                  </li>
                ))}
              </ul>
            </Stagger>
          )}
        </Card>
      </div>
    </>
  );
}
