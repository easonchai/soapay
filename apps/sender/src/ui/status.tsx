// Record status for one roster employee, shared by Pay run and Recipients.
import { motion } from "framer-motion";
import { Pill } from "@soapay/ui";
import type { Employee, Payability } from "../lib/roster.js";

/** "Re-verified by World ID": the pin was moved by a valid MetaRotation attestation. */
export function AttestedBadge({ e }: { e: Employee }) {
  if (!e.pin.attested) return null;
  return (
    <span title={`Re-verified by World ID on ${new Date(e.pin.attested.verifiedAt * 1000).toLocaleString()}`}>
      <Pill tone="accent">Re-verified by World ID</Pill>
    </span>
  );
}

/**
 * The pay-run gate for a row. `payability` undefined = not verified in this run yet;
 * `pending` = a verification is running.
 */
export function RecordStatus({ e, payability, pending, lines }: { e: Employee; payability?: Payability | undefined; pending?: boolean; lines?: number | undefined }) {
  if (!e.active) return <span className="st-muted">Paused</span>;
  if (e.pendingChange || (payability && !payability.payable && payability.reason === "changed")) {
    return <Pill tone="danger">Blocked · record changed</Pill>;
  }
  if (pending) {
    return (
      <span className="res res-wait">
        <motion.span className="sq sq-wait" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.1, repeat: Infinity }} />
        Verifying…
      </span>
    );
  }
  if (!payability || (!payability.payable && payability.reason === "unchecked")) return <span className="res ink3">Not checked</span>;
  if (!payability.payable) return <Pill tone="danger">{payability.message}</Pill>;
  return (
    <span className="res res-ok">
      <span className="sq sq-ok" />
      Verified{lines !== undefined ? ` · ${lines} fresh address${lines === 1 ? "" : "es"}` : ""}
    </span>
  );
}
