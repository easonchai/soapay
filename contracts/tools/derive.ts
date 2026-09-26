/**
 * Derive StealthDisperse.PackedPayment test data from ERC-6538 stealth meta-addresses (scheme 1).
 *
 *   pnpm derive st:eth:0x<spendPub33><viewPub33>=1000000 st:eth:0x...=2500000
 *   pnpm derive --demo 5          # random recipients, self-checks that each one can find + spend
 *
 * Prints lines sorted ascending by stealth address (as StealthDisperse requires), each with its
 * packed `head`/`keyX` words, and a `cast`-ready `(uint256,bytes32)[]` tuple array.
 *
 * Packed layout (docs/mvp-spec.md §1), big-endian:
 *   head = stealth(160) << 96 | amount(uint80) << 16 | viewTag(8) << 8 | keyPrefix(8)
 *   keyX = bytes 1..32 of the 33-byte compressed ephemeral key; keyPrefix is byte 0 (0x02/0x03)
 */
import {
  VALID_SCHEME_ID,
  checkStealthAddress,
  computeStealthKey,
  generateStealthAddress,
} from '@scopelift/stealth-address-sdk';
import { type Hex, bytesToHex, getAddress, pad, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { secp256k1 } from '@noble/curves/secp256k1';

type Line = { stealthAddress: Hex; amount: bigint; ephemeralPubKey: Hex; viewTag: Hex };
type Packed = { head: Hex; keyX: Hex };

const MAX_AMOUNT = (1n << 80n) - 1n;

const compressedPub = (pk: Hex): Hex => bytesToHex(secp256k1.getPublicKey(pk.slice(2), true));

/** Same formula as the SDK's encodeHead and the Solidity test fixture. */
function encodeLine(l: Line): Packed {
  if (l.amount <= 0n || l.amount > MAX_AMOUNT) throw new Error(`amount out of range (0, 2^80): ${l.amount}`);
  const key = l.ephemeralPubKey.slice(2);
  const prefix = BigInt(`0x${key.slice(0, 2)}`);
  if (key.length !== 66 || (prefix !== 2n && prefix !== 3n)) throw new Error('expected 33-byte compressed ephemeral key');
  const viewTag = BigInt(l.viewTag);
  if (viewTag > 0xffn) throw new Error('view tag is one byte');
  const head = (BigInt(l.stealthAddress) << 96n) | (l.amount << 16n) | (viewTag << 8n) | prefix;
  return { head: pad(toHex(head), { size: 32 }), keyX: `0x${key.slice(2)}` };
}

/** Inverse of encodeLine; used as a self-check before printing. */
function decodeHead(head: Hex) {
  const h = BigInt(head);
  return {
    stealthAddress: getAddress(pad(toHex(h >> 96n), { size: 20 })),
    amount: (h >> 16n) & MAX_AMOUNT,
    viewTag: Number((h >> 8n) & 0xffn),
    keyPrefix: Number(h & 0xffn),
  };
}

function derive(metaAddress: string, amount: bigint): Line {
  const r = generateStealthAddress({ stealthMetaAddressURI: metaAddress, schemeId: VALID_SCHEME_ID.SCHEME_ID_1 });
  if ((r.ephemeralPublicKey.length - 2) / 2 !== 33) throw new Error('expected 33-byte compressed ephemeral key');
  return { stealthAddress: r.stealthAddress, amount, ephemeralPubKey: r.ephemeralPublicKey, viewTag: r.viewTag };
}

const sortLines = (ls: Line[]) =>
  ls.sort((a, b) => (BigInt(a.stealthAddress) < BigInt(b.stealthAddress) ? -1 : 1));

function print(lines: Line[]) {
  const packed = lines.map((l) => {
    const p = encodeLine(l);
    const d = decodeHead(p.head);
    const roundTrip =
      d.stealthAddress.toLowerCase() === l.stealthAddress.toLowerCase() &&
      d.amount === l.amount &&
      d.viewTag === Number(l.viewTag) &&
      `0x${d.keyPrefix.toString(16).padStart(2, '0')}${p.keyX.slice(2)}` === l.ephemeralPubKey.toLowerCase();
    if (!roundTrip) throw new Error(`head round-trip failed for ${l.stealthAddress}`);
    console.log(JSON.stringify({ ...l, amount: l.amount.toString(), ...p }));
    return p;
  });
  console.log(`\ncast arg: [${packed.map((p) => `(${p.head},${p.keyX})`).join(',')}]`);
}

const args = process.argv.slice(2);
if (args[0] === '--demo') {
  const n = Number(args[1] ?? 3);
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const spendingPrivateKey = generatePrivateKey();
    const viewingPrivateKey = generatePrivateKey();
    const spendingPublicKey = compressedPub(spendingPrivateKey);
    const meta = `st:eth:0x${spendingPublicKey.slice(2)}${compressedPub(viewingPrivateKey).slice(2)}`;
    const line = derive(meta, BigInt(1000 + i) * 10n ** 6n);

    // recipient side: scan match + spend key derivation must agree with the sender
    const found = checkStealthAddress({
      ephemeralPublicKey: line.ephemeralPubKey,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
      spendingPublicKey,
      userStealthAddress: line.stealthAddress,
      viewTag: line.viewTag,
      viewingPrivateKey,
    });
    const stealthKey = computeStealthKey({
      ephemeralPublicKey: line.ephemeralPubKey,
      schemeId: VALID_SCHEME_ID.SCHEME_ID_1,
      spendingPrivateKey,
      viewingPrivateKey,
    });
    const spendable = privateKeyToAccount(stealthKey).address.toLowerCase() === line.stealthAddress.toLowerCase();
    if (!found || !spendable) throw new Error(`self-check failed for line ${i}`);
    lines.push(line);
  }
  console.error(`self-check ok: ${n} recipients can find and spend their line; heads round-trip`);
  print(sortLines(lines));
} else if (args.length) {
  print(
    sortLines(
      args.map((a) => {
        const [meta, amt] = a.split('=');
        if (!meta?.startsWith('st:') || !amt) throw new Error(`bad arg ${a}; expected st:eth:0x...=<amount>`);
        return derive(meta, BigInt(amt));
      }),
    ),
  );
} else {
  console.error('usage: derive.ts --demo [n] | st:eth:0x...=<amount> ...');
  process.exit(1);
}
