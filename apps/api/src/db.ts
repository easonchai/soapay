import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

/**
 * Ordered migrations. Append only; never edit a shipped entry.
 * `PRAGMA user_version` records how many have run.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE names (
    label         TEXT PRIMARY KEY,
    registrant    TEXT NOT NULL,          -- checksummed address
    meta_address  TEXT NOT NULL,          -- exactly the string the registrant signed (URI)
    meta_bytes    TEXT NOT NULL,          -- lowercase 0x hex, 66 bytes
    deadline      TEXT NOT NULL,          -- uint256 as decimal string
    signature     TEXT NOT NULL,
    nullifier     TEXT,                   -- from the HumanVerifier, when it returns one
    issue_tx_hash TEXT,                   -- from the NameIssuer, when it returns one
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX names_registrant ON names(registrant);
  CREATE INDEX names_nullifier ON names(nullifier);

  CREATE TABLE name_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    label         TEXT NOT NULL,
    registrant    TEXT NOT NULL,
    old_meta      TEXT,
    new_meta      TEXT NOT NULL,
    deadline      TEXT NOT NULL,
    nullifier     TEXT,
    tx_hash       TEXT,
    at            INTEGER NOT NULL
  );

  CREATE TABLE registrations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    registrant    TEXT NOT NULL,
    meta_bytes    TEXT NOT NULL,
    tx_hash       TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL,          -- pending | success | reverted
    block_number  TEXT,
    nullifier     TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX registrations_registrant ON registrations(registrant, meta_bytes);
  CREATE INDEX registrations_nullifier ON registrations(nullifier);

  CREATE TABLE announcements (
    block_number      INTEGER NOT NULL,
    log_index         INTEGER NOT NULL,
    tx_hash           TEXT NOT NULL,
    block_hash        TEXT NOT NULL,
    stealth_address   TEXT NOT NULL,
    caller            TEXT NOT NULL,
    ephemeral_pub_key TEXT NOT NULL,
    metadata          TEXT NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  );
  CREATE UNIQUE INDEX announcements_order ON announcements(block_number, log_index);

  CREATE TABLE indexer_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE rate_limits (
    bucket        TEXT NOT NULL,
    key           TEXT NOT NULL,
    window_start  INTEGER NOT NULL,
    count         INTEGER NOT NULL,
    PRIMARY KEY (bucket, key)
  );
  `,
  // World ID (src/worldid/*). Nullifiers and session ids only, never identity.
  `
  -- Every RP context we signed. A proof must echo one of our nonces, and each nonce is
  -- accepted at most once.
  CREATE TABLE worldid_requests (
    nonce         TEXT PRIMARY KEY,       -- lowercase 0x hex field element
    kind          TEXT NOT NULL,          -- session
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    used_at       INTEGER
  );

  -- The World ID session (Selfie Check) behind a name, if the registrant created one.
  -- A name keeps its first session; a session backs one name.
  CREATE TABLE name_sessions (
    label         TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL UNIQUE,   -- opaque session_<hex> from IDKit
    attached_at   INTEGER NOT NULL,
    via           TEXT NOT NULL           -- enroll (POST /names) | attach (POST /names/:label/session)
  );

  -- Per-proof replay protection for session proofs (create and prove).
  CREATE TABLE worldid_session_nullifiers (
    session_nullifier TEXT PRIMARY KEY,   -- decimal string
    session_id        TEXT NOT NULL,
    at                INTEGER NOT NULL
  );

  -- MetaRotation attestations (docs/mvp-spec.md §2.1), signed by ATTESTER_PRIVATE_KEY.
  CREATE TABLE attestations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    label        TEXT NOT NULL,
    old_meta     TEXT NOT NULL,
    new_meta     TEXT NOT NULL,
    verified_at  INTEGER NOT NULL,
    attester     TEXT NOT NULL,
    signature    TEXT NOT NULL,
    session_nullifier TEXT NOT NULL,
    topup_tx     TEXT
  );
  CREATE INDEX attestations_label ON attestations(label, id);
  `,
  // Employer invite links (docs/mvp-spec.md §7). The code itself is never stored, only its hash.
  `
  CREATE TABLE invites (
    code_hash     TEXT PRIMARY KEY,       -- keccak256(code), lowercase 0x hex
    label         TEXT NOT NULL,
    employer      TEXT NOT NULL,          -- checksummed address that signed the Invite
    org           TEXT,                   -- display name, optional
    expires_at    INTEGER NOT NULL,       -- unix seconds
    signature     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    claimed_at    INTEGER,
    claimed_by    TEXT                    -- registrant that claimed the label
  );
  CREATE INDEX invites_label ON invites(label, expires_at);
  `,
  // Testnet welcome drop (POST /faucet, D-52): one claim per wallet, ever.
  `
  CREATE TABLE faucet_claims (
    address       TEXT PRIMARY KEY,       -- checksummed wallet that opened the company app
    status        TEXT NOT NULL,          -- pending | sent | failed
    usdc_amount   TEXT NOT NULL,          -- base units, decimal string
    usdc_tx       TEXT,
    eth_wei       TEXT,                   -- decimal string; null when no ETH was sent
    eth_tx        TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX faucet_claims_created ON faucet_claims(created_at);
  `,
];

export function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      version++;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Opens (creating if needed) and migrates the database. Use ":memory:" in tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

/** Runs fn inside a transaction (node:sqlite is synchronous, so this is atomic per call). */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getState(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM indexer_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setState(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO indexer_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
