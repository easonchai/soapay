import { useState, type FormEvent } from "react";
import type { AddressLabel } from "@soapay/sdk";
import { Tag, Trash2 } from "lucide-react";
import { LABEL_OPTIONS, useLabels } from "../hooks/useLabels.js";
import { Addr, Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, errorMessage } from "../ui/kit.js";

export function Labels() {
  const { rows, setLabel, remove } = useLabels();
  const [address, setAddress] = useState("");
  const [label, setLabelValue] = useState<AddressLabel>("main-wallet");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setLabel(address, label);
      setAddress("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
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
          {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}
        </Card>
        <Card>
          <CardHeader title="Labelled addresses" />
          {rows.length === 0 ? (
            <EmptyState icon={Tag} title="No labels yet">
              Start with your main wallet: coworkers probably know it.
            </EmptyState>
          ) : (
            <ul className="divide-y" data-testid="labels">
              {rows.map((r) => (
                <li key={r.address} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span className="flex items-center gap-2">
                    <Addr address={r.address} chars={6} />
                    <Badge tone={r.label === "other" ? "neutral" : "warning"}>{LABEL_OPTIONS.find((o) => o.value === r.label)?.title}</Badge>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void remove(r.address)} aria-label={`Remove label for ${r.address}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
