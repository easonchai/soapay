import { BaseError, type Address, type Hash, type Hex } from "viem";
import type { AppDeps } from "./app.js";
import { readStealthMetaAddress, simulateRegisterKeysOnBehalf } from "./chain.js";
import { tx } from "./db.js";
import { ApiError, redactSig, sameBytes } from "./util.js";

export type RegistrationRow = { tx_hash: Hash; status: string; block_number: string | null };
export type RelayArgs = { registrant: Address; meta: Hex; signature: Hex };
export type Prepared = { request: unknown; args: RelayArgs };

/**
 * The ERC-6538 `registerKeysOnBehalf` relayer, shared by POST /register and the rotation
 * route. One relayer account means one nonce sequence, so every send goes through one queue.
 */
export class RegistrationRelay {
  private sendQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Pick<AppDeps, "db" | "client" | "relayer" | "config" | "logger" | "now">) {}

  get enabled(): boolean {
    return !!this.deps.relayer?.account;
  }

  /** The latest pending or successful relay of exactly this registration, if any. */
  findExisting(registrant: Address, meta: Hex): RegistrationRow | undefined {
    return this.deps.db
      .prepare(
        `SELECT tx_hash, status, block_number FROM registrations
         WHERE registrant = ? AND meta_bytes = ? AND status IN ('pending', 'success')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(registrant, meta) as RegistrationRow | undefined;
  }

  supersede(txHash: Hash): void {
    this.deps.db
      .prepare("UPDATE registrations SET status = 'superseded', updated_at = ? WHERE tx_hash = ?")
      .run(this.deps.now(), txHash);
  }

  async onChainMatches(registrant: Address, meta: Hex): Promise<boolean> {
    return sameBytes(await readStealthMetaAddress(this.deps.client, registrant), meta);
  }

  /** Simulates the registry call. Throws 400 `registration_rejected` (bad signature, stale nonce, …). */
  async prepare(args: RelayArgs): Promise<Prepared> {
    if (!this.enabled) throw new ApiError(503, "relayer_disabled", "Registration relayer is not configured");
    try {
      const { request } = await simulateRegisterKeysOnBehalf(this.deps.client, this.deps.relayer!, {
        registrant: args.registrant,
        metaAddress: args.meta,
        signature: args.signature,
      });
      return { request, args };
    } catch (e) {
      const reason = e instanceof BaseError ? e.shortMessage : "simulation failed";
      this.deps.logger.warn("relay: rejected", { registrant: args.registrant, signature: redactSig(args.signature), reason });
      throw new ApiError(400, "registration_rejected", `Registry rejected the registration: ${reason}`);
    }
  }

  /**
   * Sends a prepared request (serialised with every other send), then records it as pending.
   * `onSent` runs in the same DB transaction as the record (e.g. consuming a one-time benefit).
   */
  async send(p: Prepared, nullifier: string | null, onSent?: () => void): Promise<Hash> {
    const relayer = this.deps.relayer!;
    const send = this.sendQueue.then(() => relayer.writeContract(p.request));
    this.sendQueue = send.then(
      () => undefined,
      () => undefined,
    );
    let txHash: Hash;
    try {
      txHash = await send;
    } catch (e) {
      const reason = e instanceof BaseError ? e.shortMessage : "send failed";
      this.deps.logger.warn("relay: send failed", { registrant: p.args.registrant, signature: redactSig(p.args.signature), reason });
      throw new ApiError(400, "registration_rejected", `Registry rejected the registration: ${reason}`);
    }
    const now = this.deps.now();
    tx(this.deps.db, () => {
      this.deps.db
        .prepare(
          `INSERT INTO registrations (registrant, meta_bytes, tx_hash, status, nullifier, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(p.args.registrant, p.args.meta, txHash, nullifier, now, now);
      onSent?.();
    });
    this.deps.logger.info("relay: sent", { registrant: p.args.registrant, txHash, signature: redactSig(p.args.signature) });
    return txHash;
  }

  /** Waits for a receipt and records it; returns the stored status ("pending" on timeout). */
  async refresh(txHash: Hash): Promise<string> {
    try {
      const receipt = await this.deps.client.waitForTransactionReceipt({
        hash: txHash,
        timeout: this.deps.config.receiptTimeoutMs,
      });
      this.deps.db
        .prepare("UPDATE registrations SET status = ?, block_number = ?, updated_at = ? WHERE tx_hash = ?")
        .run(receipt.status, receipt.blockNumber.toString(), this.deps.now(), txHash);
      return receipt.status;
    } catch (e) {
      this.deps.logger.warn("relay: receipt not available yet", { txHash, error: (e as Error).message?.split("\n")[0] });
      return "pending";
    }
  }
}
