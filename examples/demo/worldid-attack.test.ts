// Pure logic of `pnpm demo:attacker-worldid` (no network). Run: pnpm --filter @soapay/examples test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capturedSessionId,
  explainRefusal,
  honestyLine,
  otherPersonSessionResult,
  parseArgs,
  readbackVerdict,
  REFUSAL_WORDS,
  shortSession,
} from "./worldid-attack.js";

describe("parseArgs", () => {
  it("defaults to the other-person attack on the default victim", () => {
    assert.deepEqual(parseArgs([], "sam-demo"), { kind: "attack", label: "sam-demo", mode: "other-person" });
    assert.deepEqual(parseArgs(["Alex-Demo"], "sam-demo"), { kind: "attack", label: "alex-demo", mode: "other-person" });
  });
  it("--replay and --setup", () => {
    assert.deepEqual(parseArgs(["sam-demo", "--replay"], "x"), { kind: "attack", label: "sam-demo", mode: "replay" });
    assert.deepEqual(parseArgs(["--setup"], "sam-demo"), { kind: "setup", label: "sam-demo" });
  });
  it("rejects unknown flags, two labels, bad labels and --setup --replay", () => {
    assert.equal(parseArgs(["--force"], "x").kind, "error");
    assert.equal(parseArgs(["a", "b"], "x").kind, "error");
    assert.equal(parseArgs(["bad label!"], "x").kind, "error");
    assert.equal(parseArgs(["--setup", "--replay"], "x").kind, "error");
    assert.equal(parseArgs(["--help"], "x").kind, "help");
  });
});

describe("otherPersonSessionResult", () => {
  it("is shaped like an IDKit 4.0 Proof of Human session result, bound to the given RP nonce", () => {
    const r = otherPersonSessionResult({ nonce: "0xabc", environment: "production" });
    assert.equal(r.protocol_version, "4.0");
    assert.equal(r.nonce, "0xabc");
    assert.equal(r.environment, "production");
    assert.match(r.session_id as string, /^session_[0-9a-f]{128}$/);
    const item = (r.responses as Record<string, unknown>[])[0]!;
    assert.equal(item.identifier, "proof_of_human");
    assert.equal(item.issuer_schema_id, 1);
    assert.equal((item.session_nullifier as string[]).length, 2);
  });
  it("never reuses the victim's session id, even if the randomness collides", () => {
    let n = 0;
    // The first 64 bytes are all zero (the victim's id below), everything after is 0x11.
    const random = (len: number) => new Uint8Array(len).fill(n++ === 0 ? 0 : 0x11);
    const victim = `session_${"00".repeat(64)}`;
    const r = otherPersonSessionResult({ nonce: "0x1", environment: "production", victimSessionId: victim, random });
    assert.notEqual(r.session_id, victim);
  });
  it("differs on every call", () => {
    const a = otherPersonSessionResult({ nonce: "0x1", environment: "production" });
    const b = otherPersonSessionResult({ nonce: "0x1", environment: "production" });
    assert.notEqual(a.session_id, b.session_id);
  });
});

describe("captured proofs and display", () => {
  it("capturedSessionId checks the stored result", () => {
    assert.equal(capturedSessionId({ session_id: "session_ab12" }), "session_ab12");
    assert.throws(() => capturedSessionId({}), /no session_id/);
    assert.throws(() => capturedSessionId({ session_id: "nope" }), /no session_id/);
  });
  it("shortSession keeps the ends", () => {
    assert.equal(shortSession(`session_${"a".repeat(60)}ffff`), "session_aaaaaa…ffff");
    assert.equal(shortSession("session_ab"), "session_ab");
  });
});

describe("words for the presenter", () => {
  it("explains the demo's refusals in plain words, without raw codes", () => {
    assert.match(explainRefusal("session_mismatch"), /different World ID .* different person/);
    assert.match(explainRefusal("session_replayed"), /already used/);
    assert.match(explainRefusal("no_session"), /no World ID link/);
    assert.equal(explainRefusal("something_new"), "The API refused to attest the change.");
    for (const w of Object.values(REFUSAL_WORDS)) assert.doesNotMatch(w, /_/);
  });
  it("is honest about what each mode simulates", () => {
    assert.match(honestyLine("other-person"), /Simulated: the thief's World ID proof/);
    assert.match(honestyLine("other-person"), /before any call to World/);
    assert.match(honestyLine("replay"), /Simulated: only that a thief captured that proof/);
  });
});

describe("readbackVerdict", () => {
  const base = {
    name: "sam-demo.soapay.eth",
    ensMeta: "st:eth:0xAA",
    beforeMeta: "st:eth:0xaa",
    attackerMeta: "st:eth:0xbb",
    attestations: [] as { newMeta: string }[],
    attestationsBefore: 0,
    pinState: "ok",
  };
  it("unchanged: same ENS record, no new attestation, pin ok", () => {
    const v = readbackVerdict(base);
    assert.equal(v.unchanged, true);
    assert.match(v.lines.join("\n"), /stealth record: unchanged/);
    assert.match(v.lines.join("\n"), /no attestation issued/);
    assert.match(v.lines.join("\n"), /still Verified/);
  });
  it("flags any change", () => {
    assert.equal(readbackVerdict({ ...base, ensMeta: "st:eth:0xbb" }).unchanged, false);
    assert.equal(readbackVerdict({ ...base, attestations: [{ newMeta: "st:eth:0xbb" }] }).unchanged, false);
    assert.equal(readbackVerdict({ ...base, attestations: [{ newMeta: "st:eth:0xcc" }] }).unchanged, false);
    assert.equal(readbackVerdict({ ...base, pinState: "blocked" }).unchanged, false);
  });
  it("older attestations on record are fine", () => {
    assert.equal(readbackVerdict({ ...base, attestations: [{ newMeta: "st:eth:0xaa" }], attestationsBefore: 1 }).unchanged, true);
  });
});
