/**
 * Derive StealthDisperse.Payment test data from ERC-6538 stealth meta-addresses (scheme 1).
 *
 *   npm run derive -- st:eth:0x<spendPub33><viewPub33>=1000000 st:eth:0x...=2500000
 *   npm run derive -- --demo 5          # random recipients, self-checks that each one can find + spend
 *
 * Prints JSON lines sorted ascending by stealth address (as StealthDisperse requires) and a
 * `cast`-ready tuple array.
 */
import {
  VALID_SCHEME_ID,
  checkStealthAddress,
  computeStealthKey,
  generateStealthAddress,
} from '@scopelift/stealth-address-sdk';
import { type Hex, bytesToHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { secp256k1 } from '@noble/curves/secp256k1';

type Line = { stealthAddress: Hex; amount: bigint; ephemeralPubKey: Hex; viewTag: Hex };

const compressedPub = (pk: Hex): Hex => bytesToHex(secp256k1.getPublicKey(pk.slice(2), true));

function derive(metaAddress: string, amount: bigint): Line {
  const r = generateStealthAddress({ stealthMetaAddressURI: metaAddress, schemeId: VALID_SCHEME_ID.SCHEME_ID_1 });
  if ((r.ephemeralPublicKey.length - 2) / 2 !== 33) throw new Error('expected 33-byte compressed ephemeral key');
  return { stealthAddress: r.stealthAddress, amount, ephemeralPubKey: r.ephemeralPublicKey, viewTag: r.viewTag };
}

const sortLines = (ls: Line[]) =>
  ls.sort((a, b) => (BigInt(a.stealthAddress) < BigInt(b.stealthAddress) ? -1 : 1));

function print(lines: Line[]) {
  for (const l of lines) console.log(JSON.stringify({ ...l, amount: l.amount.toString() }));
  const tuples = lines.map((l) => `(${l.stealthAddress},${l.amount},${l.ephemeralPubKey},${l.viewTag})`);
  console.log(`\ncast arg: [${tuples.join(',')}]`);
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
  console.error(`self-check ok: ${n} recipients can find and spend their line`);
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
